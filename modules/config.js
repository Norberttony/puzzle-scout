
const fs = require("fs");

const config = JSON.parse(fs.readFileSync("./data/config.json").toString());

module.exports = { config };
