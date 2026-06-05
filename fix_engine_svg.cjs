const fs = require('fs');

let content = fs.readFileSync('HistoricalEngine.ts', 'utf-8');

const lines = content.split('\n');

const runMultiScanIdx = lines.findIndex(l => l.includes('    return results;'));
const endIdx = lines.findIndex(l => l.includes('export function generateLocalFallbackAnalysis'));

if (runMultiScanIdx !== -1 && endIdx !== -1) {
    const cleanedLines = [
        ...lines.slice(0, runMultiScanIdx + 2),
        '}', // close the HistoricalEngine class
        ...lines.slice(endIdx) 
    ];
    
    fs.writeFileSync('HistoricalEngine.ts', cleanedLines.join('\n'), 'utf-8');
    console.log('Fixed SVG removal');
} else {
    console.log('Error: runMultiScanIdx or endIdx not found');
}
