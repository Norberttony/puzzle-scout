
const fs = require("fs");
const { config } = require("./config");


function stringifyAndPadStart(val, maxLength, fillString){
    return (val + "").padStart(maxLength, fillString);
}

function log(msg){
    const date = new Date();

    const month = date.getMonth() + 1;
    const day = date.getDate();
    const year = date.getFullYear();
    
    const hrs = stringifyAndPadStart(date.getHours(), 2, "0");
    const mins = stringifyAndPadStart(date.getMinutes(), 2, "0");
    const secs = stringifyAndPadStart(date.getSeconds(), 2, "0");
    const milli = stringifyAndPadStart(date.getMilliseconds(), 3, "0");

    const dateStr = `${day}d/${month}m/${year}y [${hrs}:${mins}:${secs}.${milli}]`;

    fs.appendFileSync(config["debug-path"], `${dateStr} ${msg}\n`);
}

module.exports = { log };
