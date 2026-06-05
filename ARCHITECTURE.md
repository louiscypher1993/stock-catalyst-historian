# Antigravity Financial Market Analysis Architecture

This document provides a comprehensive overview of the sources/inputs, analytical models, and outputs that compose the platform's anomaly detection and historical market context engine.

## 1. Sources & Inputs

The system ingests a vast array of proprietary, alternative, and open-source data to generate a multi-dimensional view of market anomalies.

* **PolygonService**: Delivers high-fidelity U.S. equities market data, price actions, options data, and corporate events.
* **EODHDService**: Supplies international stock price histories and global market fundamentals.
* **FMPService (Financial Modeling Prep)**: Provides overarching company context, earnings call transcripts, peer-group identification, and alternative metrics like historical Dark Pool volume and cost-to-borrow rates.
* **FREDService**: Interfaces with the Federal Reserve Economic Data to pull foundational macroeconomic indicators and Treasury yields.
* **NewsAPIService**: Aggregates global financial news articles for narrative and qualitative catalyst detection.
* **GDELTService**: Monitors the Global Database of Events, Language, and Tone for geopolitical risk and contagion indicators.
* **GoogleTrendsService**: Tracks real-time retail interest and search popularity indices.
* **WikipediaService**: Measures Wikipedia page traffic spikes as a proxy for organic retail attention.
* **RedditSentimentService & StockTwitsService**: Scrapes and analyzes real-time social media momentum and collective retail sentiment.
* **YouTubeService**: Extracts transcripts from relevant financial videos to capture retail influencer narratives.
* **EdgarService**: Parses complex SEC filings (10-K, 10-Q, 8-K) and insider transaction data.
* **CongressionalTradingService**: Tracks the net flow of trades made by U.S. politicians to highlight asymmetric regulatory knowledge.

## 2. Analysis Models, Methods, & Techniques

Once raw data is ingested, it is subjected to a proprietary suite of data-science techniques and quantitative models to contextualize the price anomalies.

* **RegimeDetectionService**: Utilizes hidden Markov models or rolling volatility clustering to detect the broader macroeconomic trading regime (e.g., risk-on, inflationary).
* **CorrelationEngine & MacroTrendDetector**: Strips away market beta (S&P 500) and sector beta to isolate the stock's true idiosyncratic return and identify major pivot points.
* **HistoricalSimilarityService**: Applies K-Nearest Neighbor (KNN) and cosine-similarity analogue matching across historical vector spaces to find the most statistically similar historical trading environments.
* **ExecutiveIntelligence & EarningsSentimentService**: Leverages Large Language Models to analyze executive language, identifying hesitations or semantic shifts in earnings call Q&A sessions.
* **Econophysics & Kinematics Engines**: Applies literal physical formulas (Kinetic Energy, Orbital Escape Velocity, Market Jerk, Seismic Magnitude) to measure the raw structural force and severity of a price shock.
* **Fluid Dynamics Algorithms**: Calculates the Market Reynolds Number and Fractal Efficiency Ratio to determine if the market's liquidity flow in a trend is laminar (smooth) or entering turbulent chaos.

## 3. System Outputs: Relational Databases (CSV / JSON Exports)

The ultimate output of the engine is the feature vector dataset exported for ingestion into Python-based Machine Learning models. The exact schema that makes up the columns of this dataset is categorized explicitly below:

### Category 1: The Target Labels (What the AI Predicts)
These are the y-variables calculated *after* the anomaly date.
* **max_favorable_excursion_1m**: The absolute highest percentage gain achieved within the 21 trading days following the event.
* **max_adverse_excursion_1m**: The absolute lowest percentage drop suffered within the 21 trading days following the event.
* **forward_return_1d**: The static closing percentage return 1 day post-event.
* **forward_return_1w**: The static closing percentage return 1 week post-event.
* **forward_return_1m**: The static closing percentage return 1 month post-event.

### Category 2: Anomaly Baseline & Asset Metadata
These give the neural network the scale, timing, and pure statistical severity of the event.
* **is_null_sample**: A binary flag (1 or 0) to force the model to learn from random non-events, preventing survivorship bias.
* **z_score**: The statistical standard deviation of the daily price movement.
* **market_cap_log10**: The base-10 logarithm of the company's total valuation, scaling massive and tiny companies cleanly.
* **dollar_volume_30d**: The trailing 30-day average of liquidity (Share Volume multiplied by Close Price).
* **sector_encoded**: An integer mapping of the stock's broader sector.
* **event_type_encoded**: An integer mapping of the fundamental catalyst (e.g., Earnings, SEC filing).
* **day_sin, day_cos, month_sin, month_cos**: The cyclical mathematical coordinates of the calendar date to map seasonality.

### Category 3: The Tape & Technical Micro-Structure
These variables map exactly how intraday and baseline technical traders interacted with the asset.
* **body_to_range_ratio**: Measures intraday directional conviction (the size of the candle body vs. the wicks).
* **volume_price_clustering**: Identifies whether the bulk of the day's volume was spent accumulating near the highs or distributing near the lows.
* **overnight_gap_pct**: The raw percentage jump between yesterday's close and today's open.
* **gap_fill_ratio**: The percentage of that overnight gap that was actively traded back (filled) intraday.
* **relative_volume_30d**: The volume shock multiplier (today's volume divided by the 30-day average).
* **dist_sma_50**: The percentage deviation from the 50-day Simple Moving Average.
* **dist_sma_200**: The percentage deviation from the 200-day Simple Moving Average.
* **rsi_14**: The 14-day Relative Strength Index measuring overbought/oversold momentum exhaustion.
* **volatility_contraction_index**: The width of the Bollinger Bands, pinpointing kinetic energy compression before the catalyst.

### Category 4: Macro Gravity, Contagion & Policy Risk
These inputs isolate the specific company from the broader noise of the global economy and sector rivals.
* **days_since_macro_swing**: The time elapsed since the asset's last major structural pivot.
* **swing_type_encoded**: Categorical tag for whether the asset is coming off a structural Peak or a Dip.
* **obv_delta_10d**: The 10-day momentum of On-Balance Volume, identifying stealth accumulation.
* **idiosyncratic_return**: The stock's true return *after* mathematically stripping away the S&P 500 beta and global commodity beta.
* **peer_contagion_delta**: The spread between the target stock's return and its top competitors.
* **peer_average_return**: The unweighted average daily return of those top 3 competitors.
* **treasury_10y_yield**: The US 10-Year Treasury Yield acting as the global risk-free baseline rate.
* **vix_close**: The CBOE Volatility Index, indicating the broader market's state of panic or complacency.
* **congressional_net_flow_30d**: The net dollar footprint of US politician insider trading leading into the event.
* **economic_policy_uncertainty**: The highly localized sovereign policy risk index value (EPU) for the asset's native exchange.
* **management_confidence_score**: An LLM-derived integer (1-100) scoring executive hesitation during an earnings Q&A.

### Category 5: Dark Data, Options & Forced Liquidity
These outputs track the hidden mechanics that trigger massive short squeezes and algorithmic buying.
* **dark_pool_index**: The percentage of the day's total volume executed in hidden, off-exchange venues.
* **ctb_velocity_7d**: The 7-day velocity of the Cost to Borrow fee, signaling imminent forced buying by short sellers.
* **short_interest_pct**: The total percentage of the tradable float currently sold short.
* **put_call_ratio_t_minus_1**: The balance of bearish vs. bullish options volume exactly one day *before* the event.
* **iv_crush_pct**: The percentage deflation of Implied Volatility, measuring how much uncertainty evaporated from the derivatives market.

### Category 6: Econophysics, Geometry & Fluid Dynamics
The bleeding-edge tensors that calculate the literal physical force and structural dimensions of the anomaly.
* **shannon_entropy_30d**: Information theory metric measuring the chaos and unpredictability in the recent price action.
* **amihud_illiquidity_30d**: Measures the extreme fragility of the order book (price impact per dollar spent).
* **barycenter_stretch_20d**: The gravitational stretch (percentage deviation) from the 20-day Volume-Weighted Average Price.
* **kinetic_energy**: The literal physical force of the anomaly, combining relative volume mass and squared return velocity.
* **l1_lagrange_point**: The exact dollar price of the binary gravitational null-zone where momentum will naturally decay.
* **orbital_escape_velocity**: The required return velocity to break the 200-day gravitational tether.
* **escape_velocity_cleared**: A binary flag (1 or 0) indicating if the day's return successfully defeated the escape velocity.
* **market_reynolds_number**: A fluid dynamics index determining if the trend's liquidity flow is smooth (laminar) or entering violent chaos (turbulent).
* **fractal_efficiency_ratio_10d**: A geometric metric measuring the absolute straightness and efficiency of the price trajectory over the last 10 days.
* **market_jerk**: The mathematical derivative of acceleration, measuring the exact whiplash force that shatters automated risk models.
* **seismic_magnitude_mw**: The anomaly's kinetic energy compressed down into a clean, Base-10 Gutenberg-Richter earthquake scale.
