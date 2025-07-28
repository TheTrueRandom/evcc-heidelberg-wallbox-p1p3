import got from "got";

export default class ShellySwitch {
    constructor(logger) {
        if (!process.env.SHELLY_HOST) {
            throw new Error(`Missing SHELLY_HOST`);
        }
        this.logger = logger;

        this.shellyClient = got.extend({
            prefixUrl: `http://${process.env.SHELLY_HOST}`,
            resolveBodyOnly: true,
            responseType: 'json',
            timeout: {
                request: 15_000
            },
            retry: {
                limit: 5
            }
        });
    }

    async init() {
        // todo verify shelly type etc.
        await this.isEnabled();
    }

    async isEnabled() {
        const res = await this.shellyClient.get("relay/0");
        return res.ison;
    }

    async set3Phase() {
        this.logger.info("Set 3 phase...");
        await this.shellyClient.get('relay/0?turn=on');
        this.logger.info("Successfully Set 3 phase");
    }

    async set1Phase() {
        this.logger.info("Set 1 phase...");
        await this.shellyClient.get('relay/0?turn=off');
        this.logger.info("Successfully Set 1 phase");
    }
}
