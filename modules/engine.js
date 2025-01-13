
const fs = require("fs");
const { EngineProcess } = require("./engine-process");

class Engine {
    constructor(name, path){
        this.name = name;
        this.path = path;

        this.resultTable = {};
    }

    static addResult(e1, e2, result){
        let resultRow1 = e1.getResultRow(e2.name);
        let resultRow2 = e2.getResultRow(e1.name);

        switch(result){
            case -1:
                // lost
                resultRow1.losses++;
                resultRow2.wins++;
                break;
            case 0:
                // drew
                resultRow1.draws++;
                resultRow2.draws++;
                break;
            case 1:
                // won
                resultRow1.wins++;
                resultRow2.losses++;
                break;
        }
    }
    
    createProcess(onReadLine){
        return new EngineProcess(this, onReadLine);
    }

    getResultRow(oppName){
        let resultRow = this.resultTable[oppName];
        if (!resultRow){
            this.resultTable[oppName] = { wins: 0, draws: 0, losses: 0 };
            resultRow = this.resultTable[oppName];
        }
        return resultRow;
    }
}

// extracts engines from a directory.
function extractEngines(dir){
    const engines = [];

    fs.readdirSync(dir).forEach(file => {
        if (file.endsWith(".exe")){
            // valid!
            const engine = new Engine(file.replace(".exe", ""), `${dir}/${file}`);
            engines.push(engine);
        }
    });

    return engines;
}

module.exports = { Engine, extractEngines };
