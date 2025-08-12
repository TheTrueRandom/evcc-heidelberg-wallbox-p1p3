import ModbusRTU from 'modbus-serial';
import {setTimeout} from 'node:timers/promises';
import {Mutex} from "async-mutex";
import { once, EventEmitter } from 'node:events';

export default class Wallbox extends EventEmitter{
    lastRead = new Date(0);
    data = null;
    mutex = new Mutex();
    lastPhaseSwitch = new Date(0);

    constructor(logger, p1p3Switch) {
        super();
        this.logger = logger;
        this.p1P3Switch = p1p3Switch;
        this.modbusSlaveId = process.env.MODBUS_SLAVE_ID ?? 1;

        if (!process.env.MODBUS_TCP_HOST) {
            throw new Error(`Missing MODBUS_TCP_HOST`);
        }
        if (!process.env.MODBUS_TCP_PORT) {
            throw new Error(`Missing MODBUS_TCP_PORT`);
        }
        this.host = process.env.MODBUS_TCP_HOST;
        this.port = process.env.MODBUS_TCP_PORT;
    }

    async connect() {
        try {
            this.modbusClient = new ModbusRTU();
            await this.modbusClient.connectTCP(this.host, {port: this.port});
            this.modbusClient.setID(this.modbusSlaveId);
            this.modbusClient.setTimeout(1000);
            this.logger.info(`Connected to Modbus TCP server at ${this.host}:${this.port} with slaveId ${this.modbusSlaveId}`);
            await this.disableStandby();
        } catch (e) {
            this.logger.error(e, 'Failed to connect to Modbus server:');
            throw e;
        }
    }

    async disableStandby() {
        this.logger.debug('Disable Wallbox Standby');
        await this.modbusClient.writeRegisters(258, [4]);
        this.logger.info('Disabled Wallbox Standby');
    }

    getStrStatus(state) {
        switch (state) {
            case 2:
            case 3:
                return "A"
            case 4:
            case 5:
            case 10: // todo evcc has some logic for status 10, should definitely not just return B
                return "B";
            case 6:
            case 7:
                return "C"
        }

        throw new Error(`Invalid status ${state}`);
    }

    async readWallbox() {
        this.logger.info('Start reading...');
        while (true) {
            try {
                this.emit('refreshStart');
                const res1 = await this.modbusClient.readInputRegisters(5, 14);
                const res2 = await this.modbusClient.readHoldingRegisters(261, 1); // maxCurrent

                this.data = {
                    state: res1.data[0],
                    currents: [res1.data[1] / 10, res1.data[2] / 10, res1.data[3] / 10],
                    temperature: res1.data[4] / 10,
                    voltages: [res1.data[5], res1.data[6], res1.data[7]],
                    power: res1.data[9], // W (VA)
                    energySincePowerOn: (res1.data[10] << 16 | res1.data[11]) / 1000, // kWh (KVAH)
                    energySinceInstall: (res1.data[12] << 16 | res1.data[13]) / 1000, // kWh (KVAH)
                    maxCurrent: res2.data[0] / 10 // A
                }

                this.emit("refreshSuccess");
                this.lastRead = new Date();
            } catch (e) {
                this.logger.error(e, `Failed reading wallbox`);
            } finally {
                await setTimeout(2_000);
            }
        }
    }

    getEvccData(propertyName) {
        if (new Date() - this.lastRead > 30_000) {
            throw new Error(`Wallbox data is outdated. Check logs for any errors.`);
        }

        return {
            status: this.getStrStatus(this.data.state),
            enabled: this.data.maxCurrent !== 0,
            power: this.data.power,
            current1: this.data.currents[0],
            current2: this.data.currents[1],
            current3: this.data.currents[2],
            voltage1: this.data.voltages[0],
            voltage2: this.data.voltages[1],
            voltage3: this.data.voltages[2]
        }[propertyName];
    }

    async setMaxCurrent(current) {
        if (this.mutex.isLocked()) {
            // todo instead of ignore, keep only the last command and apply it when unlocked
            this.logger.warn(`Ignoring max current command ${current} because mutex is locked`);
            return false;
        }
        return await this.mutex.runExclusive(async () => this.#setMaxCurrent(current));
    }

    async set3Phase(toEnable) {
        if (this.mutex.isLocked()) {
            this.logger.warn(`Ignoring set3Phase command ${toEnable} because mutex is locked`);
            return false;
        }
        return await this.mutex.runExclusive(async () => this.#set3Phase(toEnable));
    }

    async #setMaxCurrent(current) {
        if (current < 0 || current > 16) {
            this.logger.warn(`Invalid attempt to set max current to ${current}`);
            return;
        }
        if (current < 6) {
            current = 0;
        }
        current = Math.round(current * 10) / 10;
        if (current === this.data.maxCurrent) {
            return;
        }
        this.logger.info(`Set max current to ${current}`);
        await this.modbusClient.writeRegisters(261, [current * 10]);
    }

    async #set3Phase(toEnable) {
        const isSwitchEnabled = await this.p1P3Switch.isEnabled();
        if (isSwitchEnabled === toEnable) {
            return true;
        }

        this.logger.info(`Need to switch 3 phase from ${isSwitchEnabled} to ${toEnable}`);
        if (Date.now() - this.lastPhaseSwitch.getTime() < 10_000) {
            this.logger.warn(`Last Switch of phase was ${this.lastPhaseSwitch}, denying changing too fast.`);
            return false;
        }

        // first we need to pause the current charging
        // always request maxCurrent to 0 (even if current data is 0), to ensure that this is the latest command for maxCurrent
        await this.#setMaxCurrent(0);

        // *ensure* wait at least one full iteration of the refresh loop to guarantee the data is not outdated
        await Promise.race([
            new Promise(async (resolve) => {
                await once(this, 'refreshStart');
                await once(this, 'refreshSuccess');
                resolve();
            }),
            new Promise(async (resolve, reject) => {
                await setTimeout(30_000);
                reject(new Error("Timeout reached during phase switching when waiting for new data from modbus"));
            })
        ]);

        // wait for the vehicle to stop charging (wanted is wallbox state 4 or 5)
        for (let i = 0; i < 10; i++) {
            if (this.data.state === 4 || this.data.state === 5) {
                break;
            }
            this.logger.info(`Waiting for wallbox to stop charging... power: ${this.data.power}W state: ${this.data.state}`);
            await setTimeout(1000);
            if (i === 9) {
                throw new Error('Timeout reached during phase switching while waiting for vehicle to stop charging');
            }
        }

        this.logger.info(`Switching phase, current power is ${this.data.power} state: ${this.data.state}`);
        await (toEnable ? this.p1P3Switch.set3Phase() : this.p1P3Switch.set1Phase());
        this.lastPhaseSwitch = new Date();
        return true;
    }
}
