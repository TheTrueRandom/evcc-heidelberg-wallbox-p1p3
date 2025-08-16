import Wallbox from "./wallbox.js";
import ShellySwitch from "./shelly-switch.js";
import Fastify from "fastify";

const LOG_LEVEL = process.env.LOG_LEVEL ?? 'info';

const fastify = Fastify({
    logger: {
        transport: {
            target: 'pino-pretty',
            options: {
                colorize: true,
                ignore: 'pid,hostname,reqId,responseTime,req,res',
            }
        },
        level: LOG_LEVEL,
    },
    disableRequestLogging: true
});

fastify.setErrorHandler((error, request, reply) => {
    request.log.error({error: {message: error.message}, request: {method: request.method, url: request.url}}, 'An error occurred in a handler');
    reply.status(error.statusCode || 500).send({
        success: false,
        message: error.message || 'Internal Server Error',
        code: error.statusCode || 500,
    });
});

const shellySwitch = new ShellySwitch(fastify.log);
const wallbox = new Wallbox(fastify.log, shellySwitch);
await wallbox.connect();
await wallbox.disableStandby();
wallbox.readWallbox();

// GET Endpoints
fastify.get('/status', () => wallbox.getEvccData("status"));
fastify.get('/enabled', () => wallbox.getEvccData("enabled"));
fastify.get('/power', () => wallbox.getEvccData("power"));
fastify.get('/current/1', () => wallbox.getEvccData("current1"));
fastify.get('/current/2', () => wallbox.getEvccData("current2"));
fastify.get('/current/3', () => wallbox.getEvccData("current3"));
fastify.get('/voltage/1', () => wallbox.getEvccData("voltage1"));
fastify.get('/voltage/2', () => wallbox.getEvccData("voltage2"));
fastify.get('/voltage/3', () => wallbox.getEvccData("voltage3"));

// POST Endpoints
fastify.post('/enable', async (request, reply) => {
    // todo seems like nothing to do if true is sent here, as maxcurrent endpoint will also be called
    // todo probably max current should just save the value and /enable will finally enable it
    if (request.body.value !== "true") {
        fastify.log.info(`EVCC request set enable to ${request.body.value}`);
        await wallbox.setMaxCurrent(0);
    }
    return true;
});
fastify.post('/phases1p3p', async (request, reply) => {
    fastify.log.info(`EVCC request set phases to ${request.body.value}`);
    const enable3Phase = parseFloat(request.body.value) === 3;
    return await wallbox.set3Phase(enable3Phase);
});
fastify.post('/maxcurrent', async (request, reply) => {
    const value = parseFloat(request.body.value);
    fastify.log.info(`EVCC request set maxCurrent to ${value}`);
    return await wallbox.setMaxCurrent(value);
});
fastify.post('/maxcurrentmillis', async (request, reply) => {
    const value = parseFloat(request.body.value);
    fastify.log.info(`EVCC request set maxcurrentmillis to ${value}`);
    return await wallbox.setMaxCurrent(value);
});

await fastify.listen({port: 3000, host: '0.0.0.0'});
fastify.log.info("Server is running at http://localhost:3000");
