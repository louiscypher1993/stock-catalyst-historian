const fs = require('fs');

let content = fs.readFileSync('HistoricalEngine.ts', 'utf-8');

// Replace in run_scan
content = content.replace(
  '    const visualizationSvg = this.generateVisualizationSvg(uppercaseSymbol, points, finalAnomalies);\n\n    return {\n      symbol: uppercaseSymbol,\n      companyName: result.meta?.symbol || uppercaseSymbol,\n      currency: result.meta?.currency || "USD",\n      meta: {\n        range,\n        regularMarketPrice: result.meta?.regularMarketPrice || null,\n        chartPreviousClose: result.meta?.chartPreviousClose || null,\n      },\n      points,\n      anomalies: finalAnomalies,\n      visualization: visualizationSvg,\n    };',
  `    const chartData: ChartPoint[] = points.map(p => ({
      date: p.date,
      timestamp: p.timestamp,
      price: p.close,
      volume: p.volume,
      zScore: p.zScore,
      rollingMean: p.rollingMean,
      isAnomaly: p.isAnomaly,
      dailyReturn: p.dailyReturn
    }));

    return {
      symbol: uppercaseSymbol,
      companyName: result.meta?.symbol || uppercaseSymbol,
      currency: result.meta?.currency || "USD",
      meta: {
        range,
        regularMarketPrice: result.meta?.regularMarketPrice || null,
        chartPreviousClose: result.meta?.chartPreviousClose || null,
      },
      points,
      anomalies: finalAnomalies,
      chartData
    };`
);

// Replace in run_multi_scan
content = content.replace(
  '        res.visualization = this.generateVisualizationSvg(uppercaseSymbol, res.points, updatedAnomalies);\n      }\n    }\n\n    return results;',
  `        res.chartData = res.points.map(p => ({
          date: p.date,
          timestamp: p.timestamp,
          price: p.close,
          volume: p.volume,
          zScore: p.zScore,
          rollingMean: p.rollingMean,
          isAnomaly: p.isAnomaly,
          dailyReturn: p.dailyReturn
        }));
      }
    }

    return results;`
);

// Remove generateVisualizationSvg
content = content.replace(/\/\*\*\n   \* Layout visual graph coordinates inside clean native SVG string\n   \*\/\n  private generateVisualizationSvg[\s\S]*?  }\n/g, '');

fs.writeFileSync('HistoricalEngine.ts', content, 'utf-8');
console.log('Fixed HistoricalEngine.ts');
