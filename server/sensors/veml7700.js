let i2c = null;
let bus = null;

const BUS_NUMBER = 0;
const ADDRESS = 0x10;

const ALS_CONF = 0x00;
const ALS_DATA = 0x04;

function startLightSensor() {
  try {
    i2c = require("i2c-bus");
    bus = i2c.openSync(BUS_NUMBER);

    // gain x1, integration time 100ms, sensor enabled
    bus.writeWordSync(ADDRESS, ALS_CONF, 0x0000);

    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function readLightSensor() {
  if (!bus) {
    throw new Error("VEML7700 sensor is not available");
  }

  const raw = bus.readWordSync(ADDRESS, ALS_DATA);
  const lux = raw * 0.0576;

  return {
    raw,
    lux: Number(lux.toFixed(2)),
    updatedAt: Date.now(),
  };
}

module.exports = {
  startLightSensor,
  readLightSensor,
};