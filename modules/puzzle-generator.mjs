
import { parentPort, workerData } from "worker_threads";
import fs from "fs";

import { log } from "./logger.mjs";
import { Board } from "./game/game.mjs";
import * as PGN_Handler from "./pgn-file-reader.mjs";

import { analyzeGame, findBlunders } from "./game-analysis.mjs";
import { generatePuzzleCandidates, verifySolution, formatPuzzle } from "./puzzle-helpers.mjs";

import { config } from "./config.mjs";
import { extractEngines } from "./engine.mjs";


const shallowPly = config["shallow-search-depth-ply"];
const blunderMag = config["blunder-magnitude"];

const engineWrapper = extractEngines(workerData.data.engineDir)[0];


parentPort.on("message", async ({ pgn, id }) => {
    parentPort.postMessage(await generatePuzzles(pgn, id, engineWrapper));
});


// starts an engine and ensures it is UCI-compliant and ready.
// the returned engine must be closed using the engine.stop() method.
async function prepareEngineProcess(engineWrapper){
    log(`Starting engine ${engineWrapper.name}...`);
    const engine = engineWrapper.createProcess();
    await engine.prompt("uciready", "uciok");
    await engine.prompt("isready", "readyok");
    log("Engine ready to go.");
    return engine;
}

async function generatePuzzles(pgn, gameId, engineWrapper){
    // prepare engine
    const engine = await prepareEngineProcess(engineWrapper);

    // extract PGN headers
    const headers = PGN_Handler.extractHeaders(pgn);
    const board = new Board();
    
    if (headers.FEN)
        board.loadFEN(headers.FEN);

    log("PGN Headers extracted");
    log(`Game identifier is ${headers.Site}`);

    // extract all move objects to play on the board
    const moves = extractMoveObjects(pgn);
    log(`Total of ${moves.length} moves extracted`);

    // analyze each position
    log("Analyzing game...");
    const analysis = await analyzeGame(board.getFEN(), moves, engine, shallowPly);
    fs.writeFileSync(`./debug/${gameId}-analysis.json`, JSON.stringify(analysis));

    // identify blunders from analysis
    log("Searching for blunders...");
    const blunders = findBlunders(analysis, blunderMag);
    log(`${blunders.length} blunders have been found.`);
    fs.writeFileSync(`./debug/${gameId}-blunders.json`, JSON.stringify(blunders));

    const candidates = generatePuzzleCandidates(blunders, config["winner-max"]);
    fs.writeFileSync(`./debug/${gameId}-candidates.json`, JSON.stringify(candidates));

    // convert a list of candidates into a list of potential puzzles.
    const puzzles = [];
    for (const candidate of candidates){
        board.loadFEN(candidate.fenBeforeMistake);
        board.makeMove(candidate.leadingMistake);
        const afterBlunderFEN = board.getFEN();

        log(`Verifying candidate: ${JSON.stringify(candidate)}`);

        const puzzle = await verifySolution(candidate, engine, config["verify-search-ply"], config["verify-delta"]);

        log(`After verification: ${JSON.stringify(puzzle)}`);

        if (!puzzle)
            continue;

        const formatted = formatPuzzle(afterBlunderFEN, puzzle, candidate.scoreAfterMistake, board.turn);
        
        formatted.beforeBlunderFEN = candidate.fenBeforeMistake;
        formatted.fromGame = pgn;

        puzzles.push(formatted);
    }

    log(`Generated ${puzzles.length} additional puzzles`);
    fs.writeFileSync(`./debug/${gameId}-puzzles.json`, JSON.stringify(puzzles));

    engine.stop();

    return puzzles;
}

function extractMoveObjects(pgn){
    const headers = PGN_Handler.extractHeaders(pgn);
    const board = new Board();
    
    if (headers.FEN)
        board.loadFEN(headers.FEN);

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

    return moves;
}
