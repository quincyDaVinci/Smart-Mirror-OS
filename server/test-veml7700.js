const { startLightSensor, readLightSensor } = require("./sensors/veml7700");

startLightSensor();

setInterval(() => {
  const reading = readLightSensor();
  console.log(`raw=${reading.raw} lux=${reading.lux}`);
}, 1000);