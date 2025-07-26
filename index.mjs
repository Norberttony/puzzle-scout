
import fs from "fs";
import pathModule from "path";
import { cpus } from "os";

import * as PGN_Handler from "hyper-chess-board/pgn";
import { Board } from "hyper-chess-board";
import { ProgressBar } from "./modules/progress-bar.mjs";
import { config } from "./modules/config.mjs";
import { TaskManager } from "./modules/task-manager.mjs";


{
    const puzzlePotential = openJSONFile(config["results-path"]) || [];
    const gameData = fetchGameData();

    const bar = new ProgressBar("Processing games...");

    const threads = 1; // cpus().length / 2
    const tm = new TaskManager("./modules/puzzle-generator.mjs", threads, { engineDir: "./engine" });

    let gamesProcessed = 0;
    const totalGames = gameData.games.length;

    if (totalGames == 0){
        console.log("\nNo games left to analyze");
        process.exit();
    }

    for (const { pgn, id } of gameData.games){
        tm.doTask({ pgn, id })
            .then((puzzles) => {
                gamesProcessed++;
                bar.progress = gamesProcessed / totalGames;

                // remove from games list
                for (let i = 0; i < gameData.games.length; i++){
                    if (gameData.games[i].id == id){
                        gameData.games.splice(i, 1);
                        break;
                    }
                }
                fs.writeFileSync("./data/games.json", JSON.stringify(gameData));

                puzzlePotential.push(...puzzles);
                fs.writeFileSync(config["results-path"], JSON.stringify(puzzlePotential));

                if (gamesProcessed == totalGames)
                    tm.terminate();
            });
    }
}


function isDirectory(path){
    return fs.lstatSync(path).isDirectory();
}

// reads the games directory, extracts all PGNs
function fetchGameData(){
    // read in PGNs currently stored in games.json
    const gameData = openJSONFile("./data/games.json") || { "games": [], "counter": 0 };

    const gamesPath = "./games";
    const gamesScannedPath = "./games-scanned";

    // read in unscanned games located under the gamesPath directory
    const dir = fs.readdirSync(gamesPath);
    for (const name of dir){
        const path = pathModule.join(gamesPath, name);
        if (name.endsWith(".pgn") && !isDirectory(path)){
            // open up pgn file and add new games to the list
            const pgns = PGN_Handler.splitPGNs(fs.readFileSync(path).toString());
            for (const pgn of pgns){
                gameData.games.push({ pgn, id: gameData.counter++ });
            }
            console.log(`Extracted ${pgns.length} games from ${name}`);
            fs.renameSync(path, pathModule.join(gamesScannedPath, name));
        }
    }

    // save newly scanned games
    fs.writeFileSync("./data/games.json", JSON.stringify(gameData));

    return gameData;
}

function prepareCmdsFile(){
    let cmds = ``;
    let timeout = 20;
    let p = 0;
    for (const pgn of gamePGNs){
        const board = new Board();

        // extract all move objects to play on the board
        const moveStrings = PGN_Handler.extractMoves(pgn);
        const moves = [];
        for (const m of moveStrings.split(" ")){
            const move = board.getMoveOfSAN(m);
            if (move){
                moves.push(move);
                board.makeMove(move);
                move.san = m;
                timeout--;
                if (timeout == 0){
                    timeout = 10;
                    cmds += `
clear hash
position fen ${board.getFEN()}
go movetime 10000
`;
                    p++;
                }
            }
        }
    }
    console.log(`Gathered ${p} positions`);
    fs.writeFileSync("./cmds.txt", cmds);
}

function openJSONFile(path){
    // a try-catch is used because JSON.parse fails when the given file does not contain valid JSON
    try {
        if (fs.existsSync(path))
            return JSON.parse(fs.readFileSync(path).toString())
        else
            return undefined;
    }
    catch(err){
        console.error(err);
        return undefined;
    }
}
