import fs from 'fs';
import path from 'path';
import { db } from './db';
import { StockAnalysis } from './src/types';

interface GraphNode {
  id: string;
  type: string;
}

interface GraphEdge {
  source_node_id: string;
  target_node_id: string;
  relationship_type: string;
  weight: number;
}

export function generateGraphDataset() {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const nodeSet = new Set<string>();

  const addNode = (id: string, type: 'STOCK' | 'EXECUTIVE' | 'MACRO_EVENT') => {
    if (!id) return;
    const cleanId = id.toString().trim();
    if (!nodeSet.has(cleanId)) {
      nodeSet.add(cleanId);
      nodes.push({ id: cleanId, type });
    }
  };

  const addEdge = (source: string, target: string, type: string, weight: number) => {
    if (!source || !target) return;
    edges.push({
      source_node_id: source.toString().trim(),
      target_node_id: target.toString().trim(),
      relationship_type: type,
      weight: parseFloat(weight.toFixed(4))
    });
  };

  try {
    // 1. Process Stocks from competitor maps
    const competitorRows = db.prepare('SELECT symbol, competitors_json FROM competitor_maps').all() as any[];
    for (const row of competitorRows) {
      addNode(row.symbol, 'STOCK');
      try {
        const comps = JSON.parse(row.competitors_json);
        for (const comp of comps) {
          if (comp.symbol) {
            addNode(comp.symbol, 'STOCK');
            addEdge(row.symbol, comp.symbol, 'COMPETES_WITH', 1.0);
          }
        }
      } catch (e) {
        // ignore JSON parse errors
      }
    }

    // 2. Process Executives and Insider Transactions
    const insiderRows = db.prepare(`SELECT symbol, executive_name, shares, price_per_share, total_value FROM insider_transactions`).all() as any[];
    for (const row of insiderRows) {
      addNode(row.symbol, 'STOCK');
      const execName = row.executive_name ? row.executive_name.replace(/\s+/g, '_').toUpperCase() : 'UNKNOWN_EXEC';
      addNode(execName, 'EXECUTIVE');
      
      let val = row.total_value;
      if (!val && row.shares && row.price_per_share) {
        val = Math.abs(row.shares * row.price_per_share);
      }
      
      addEdge(execName, row.symbol, 'INSIDER_TRADED_ON', Math.abs(val || 1000));
    }

    // 3. Process Macro Events and Catalyst Links from Anomalies
    const anomalyRows = db.prepare(`SELECT symbol, date, analysis FROM anomaly_cache`).all() as any[];
    
    for (const row of anomalyRows) {
      addNode(row.symbol, 'STOCK');
      
      try {
        const analysis = JSON.parse(row.analysis) as StockAnalysis;
        
        // Find the matching feature vector for zScore
        const featureRow = db.prepare(`SELECT features_json FROM event_features WHERE cache_key = ?`).get(`${row.symbol}_${row.date}`) as any;
        let zScore = 1.0;
        if (featureRow) {
          const features = JSON.parse(featureRow.features_json);
          zScore = Math.abs(features.zScore || 1.0);
        }

        if (analysis.macroRelease && analysis.macroRelease.releaseType) {
          // Macro event trigger
          const macroId = `MACRO_${analysis.macroRelease.releaseType.toUpperCase().replace(/\s+/g, '_')}`;
          addNode(macroId, 'MACRO_EVENT');
          
          let surprise = analysis.macroRelease.surprise;
          if (surprise === undefined || surprise === null) surprise = 1.0;
          
          addEdge(macroId, row.symbol, 'MACRO_SHOCK_CAUSED', Math.abs(surprise));
        }
        
        // Catalyst link (Self-loop or specific event representation in graph context)
        addEdge(row.symbol, row.symbol, 'CATALYST_LINK', zScore);
        
      } catch (e) {
        // ignore parsing errors
      }
    }

    // Write to disk
    const outDir = process.cwd();
    fs.writeFileSync(path.join(outDir, 'nodes.json'), JSON.stringify(nodes, null, 2));
    fs.writeFileSync(path.join(outDir, 'edges.json'), JSON.stringify(edges, null, 2));

    console.log(`Graph dataset generated successfully: ${nodes.length} nodes, ${edges.length} edges.`);
    return { nodesCount: nodes.length, edgesCount: edges.length };
  } catch (err) {
    console.error("Failed to generate graph dataset:", err);
    throw err;
  }
}
