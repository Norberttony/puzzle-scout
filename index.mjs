
import fs from "fs";

import { extractEngines } from "./modules/engine.mjs";
import { getEvaluation, analyzeGame, isMate, findBlunders, getMovesFromPV, verifyCandidate, formatPuzzle } from "./modules/engine-helpers.mjs";
import * as PGN_Handler from "./modules/pgn-file-reader.mjs";
import { Board } from "./game/game.mjs";
import { ProgressBar } from "./modules/progress-bar.mjs";
import { log } from "./modules/logger.mjs";
import { config } from "./modules/config.mjs";


const engineWrapper = extractEngines("./engine")[0];

const shallowPly = config["shallow-search-depth-ply"];
const extraPly = config["confirm-search-additional-ply"];
const blunderMag = config["blunder-magnitude"];
const winnerMax = config["winner-max"];

const bar = new ProgressBar("Processing games...");

fs.readFile(config["games-path"], async (err, data) => {
    if (err)
        throw new Error(err);

    log("BEGIN ANALYSIS");

    data = data.toString();
    const gamePGNs = PGN_Handler.splitPGNs(data);

    const gameCount = gamePGNs.length;
    let gamesProcessed = 0;

    // try to read from file first.
    const puzzlePotential = fs.existsSync(config["results-path"]) ? JSON.parse(fs.readFileSync(config["results-path"]).toString()) : [];

    for (const pgn of gamePGNs){
        log(`Processing game ${gamesProcessed}`);

        log(`Starting engine ${engineWrapper.name}...`);

        let tempLog = "";
        const engine = engineWrapper.createProcess(
            (line) => {
                tempLog += `${line}\n`;
            }
        );

        await engine.prompt("uciready", "uciok");
        await engine.prompt("isready", "readyok");

        log("Engine ready to go.");

        const headers = PGN_Handler.extractHeaders(pgn);
        const board = new Board();
        
        if (headers.FEN)
            board.loadFEN(headers.FEN);

        log("PGN Headers extracted");
        log(`Game identifier is ${headers.Site}`);

        // extract all move objects to play on the board
        const moveStrings = PGN_Handler.extractMoves(pgn);
        const moves = [];
        for (const m of moveStrings.split(" ")){
            const move = board.getMoveOfSAN(m);
            if (move){
                moves.push(move);
                board.makeMove(move);
                move.san = m;
            }
        }

        log(`Total of ${moves.length} moves extracted`);

        for (let i = moves.length - 1; i >= 0; i--)
            board.unmakeMove(moves[i]);

        log("Analyzing game...");

        const analysis = await analyzeGame(board.getFEN(), moves, engine, shallowPly);

        log("Searching for blunders...");

        // convert the list of analyses of each intermediate position into a list of blunders.
        const blunders = await findBlunders(analysis, engine, blunderMag, shallowPly + extraPly, winnerMax);

        log(`${blunders.length} blunders have been found. Beginning verification phase...`);

        // convert a list of blunders into a list of potential puzzles.
        const puzzles = [];
        for (const blunder of blunders){
            board.loadFEN(blunder.fen);
            board.makeMove(blunder.move);
            const afterBlunderFEN = board.getFEN();

            log(`Looking at puzzle: ${blunder.val} ${blunder.pv}`);

            // extract PV into actual move objects
            const candidate = getMovesFromPV(afterBlunderFEN, blunder.pv);

            const puzzle = await verifyCandidate(afterBlunderFEN, candidate, engine, blunder.val, config["verify-search-ply"], config["verify-delta"]);

            if (!puzzle)
                continue;

            const formatted = formatPuzzle(afterBlunderFEN, puzzle, blunder.val, blunder.color);
            formatted.beforeBlunderFEN = blunder.fen;
            puzzles.push(formatted);
        }

        log(`Generated ${puzzles.length} additional puzzles`);

        puzzlePotential.push(...puzzles);
        fs.writeFileSync(config["results-path"], JSON.stringify(puzzlePotential));

        gamesProcessed++;
        engine.stop();
    }

    log(`Finished considering all puzzle candidates. Found ${puzzlePotential.length} candidates.`);
});


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
