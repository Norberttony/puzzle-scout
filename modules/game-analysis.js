
import fs from "node:fs";

import { Board, Piece, StartingFEN } from "hyper-chess-board";
import * as PGN_Handler from "hyper-chess-board/pgn";
import { getEvaluation } from "./engine-helpers.js";


// an object that handles the analysis of a game
// if there is previous analysis data saved it must be fed as input into the constructor.
export class Analysis {
    constructor(pgn, engineProc, filePath){
        this.pgn = pgn;
        this.engineProc = engineProc;
        this.filePath = filePath;
        this.analysis = [];

        // either zero-initializes OR, if the file exists, initializes with data from the file.
        if (!fs.existsSync(filePath)){
            fs.writeFileSync(filePath, "[]");
            this.analysis = [];
        }else{
            this.analysis = JSON.parse(fs.readFileSync(filePath).toString());
        }

        // read from PGN
        this.headers = PGN_Handler.extractHeaders(pgn);
        this.moves = extractMoveObjects(pgn);
        this.fen = this.headers.FEN || StartingFEN;
        this.movesUCI = [];
        
        const board = new Board();
        board.loadFEN(this.fen);
        this.initialSTP = board.turn;
        this.initialNSTP = board.turn == Piece.white ? Piece.black : Piece.white;

        // progress the board state based on analysis progress
        for (let i = 0; i < this.analysis.length; i++)
            this.movesUCI.push(this.moves[i].uci);
    }

    // whether or not the game is yet to be fully analyzed
    canAnalyze(){
        return this.analysis.length < this.moves.length;
    }

    // returns the analysis
    getAnalysis(){
        return this.analysis;
    }

    // performs an analysis of the current position
    async once(timeMs){
        const movePlayed = this.moves[this.analysis.length].uci;

        // analyze...
        this.engineProc.write(`position fen ${this.fen} moves ${this.movesUCI.join(" ")}`);
        const analysis = await getEvaluation(
            this.engineProc,
            `go movetime ${timeMs}`,
            this.movesUCI.length % 2 ? this.initialNSTP : this.initialSTP,
            timeMs + 400
        );
        
        // add the move that was played
        analysis.movePlayed = movePlayed;

        this.movesUCI.push(movePlayed);

        this.analysis.push(analysis);
        this.save();
    }

    save(){
        fs.writeFileSync(this.filePath, JSON.stringify(this.analysis));
    }
}

// analysis returned from analyzeGame with a { score, pv, fenBeforeMove, move, ply, log, color } per position, excluding
// the first position which does not have a move.
// returns a list of { badMove, beforeScore, afterScore, fenBeforeBadMove, expectedPV, punishPV, horizonEffect }
export function findBlunders(analysis, blunderMag){
    const blunders = [];

    let prevThink = analysis[0];
    for (let i = 1; i < analysis.length; i++){
        const thisThink = analysis[i];
        const blunder = {
            badMove: thisThink.move,
            beforeScore: prevThink.score,
            afterScore: thisThink.score,
            fenBeforeBadMove: thisThink.fenBeforeMove,
            expectedPV: prevThink.pv,
            punishPV: thisThink.pv,
            horizonEffect: false
        };

        if (thisThink.score.isMate && prevThink.score.isMate){
            // user played a move such that it takes longer to force a win
            // in this case, this is noted as a blunder.
            if (prevThink.score.value - thisThink.score.value != 1){
                blunders.push(blunder);
            }
        }else if (prevThink.score.isMate){
            // user missed a mate
            blunders.push(blunder);
        }else if (thisThink.score.isMate){
            if (thisThink.color == Piece.white && thisThink.score.value < 0 || thisThink.color == Piece.black && thisThink.score.value > 0){
                // the horizon effect might have occurred (if white played a move, and only NOW it is a forced mate for white)
                blunder.horizonEffect = true;
                blunders.push(blunder);
            }
        }else{
            const delta = Math.abs(thisThink.score.value - prevThink.score.value);
            if (delta >= blunderMag){
                if (thisThink.color == Piece.white && thisThink.score.value < 0 || thisThink.color == Piece.black && thisThink.score.value > 0){
                    // the horizon effect might have occurred (if white played a move, and only NOW it is winning for white)
                    blunder.horizonEffect = true;
                }
                blunders.push(blunder);
            }
        }

        prevThink = thisThink;
    }
    
    return blunders;
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
