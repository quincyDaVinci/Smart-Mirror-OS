const i2c = require("i2c-bus");

const BUS_NUMBER = 0;
const ADDRESS = 0x10;

const ALS_CONF = 0x00;
const ALS_DATA = 0x04;

let bus;

function startLightSensor() {
  bus = i2c.openSync(BUS_NUMBER);

  // gain x1, integration time 100ms, sensor enabled
  bus.writeWordSync(ADDRESS, ALS_CONF, 0x0000);
}

function readLightSensor() {
  if (!bus) {
    throw new Error("VEML7700 sensor is not started");
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