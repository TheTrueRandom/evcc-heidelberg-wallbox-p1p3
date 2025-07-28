import got from "got";

export default class ShellySwitch {
    enabled = false;

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
        const res = await this.shellyClient.get("relay/0");
        this.enabled = res.ison;
    }

    async set3Phase() {
        this.logger.info("Set 3 phase...");
        await this.shellyClient.get('relay/0?turn=on');
        this.enabled = true;
        this.logger.info("Successfully Set 3 phase");
    }

    async set1Phase() {
        this.logger.info("Set 1 phase...");
        await this.shellyClient.get('relay/0?turn=off');
        this.enabled = false;
        this.logger.info("Successfully Set 1 phase");
    }
}
