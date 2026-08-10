import * as fs from 'fs';
import * as path from 'path';

export interface Stock {
  symbol: string;
  companyName: string;
}

export interface Market {
  name: string;
  stocks: Stock[];
}

export const GLOBAL_MARKETS: Market[] = [
  {
    "name": "New York Stock Exchange (NYSE)",
    "stocks": [
      {
        "symbol": "AA",
        "companyName": "Alcoa Corporation"
      },
      {
        "symbol": "ABBV",
        "companyName": "AbbVie Inc."
      },
      {
        "symbol": "ABT",
        "companyName": "Abbott Laboratories"
      },
      {
        "symbol": "ACN",
        "companyName": "Accenture plc"
      },
      {
        "symbol": "ADM",
        "companyName": "Archer-Daniels-Midland"
      },
      {
        "symbol": "ADP",
        "companyName": "Automatic Data Processing"
      },
      {
        "symbol": "AEP",
        "companyName": "American Electric Power"
      },
      {
        "symbol": "AIG",
        "companyName": "American International Group"
      },
      {
        "symbol": "AJG",
        "companyName": "Arthur J. Gallagher & Co."
      },
      {
        "symbol": "ALB",
        "companyName": "Albemarle Corporation"
      },
      {
        "symbol": "AME",
        "companyName": "AMETEK, Inc."
      },
      {
        "symbol": "AMP",
        "companyName": "Ameriprise Financial, Inc."
      },
      {
        "symbol": "AMT",
        "companyName": "American Tower"
      },
      {
        "symbol": "AON",
        "companyName": "Aon plc"
      },
      {
        "symbol": "APH",
        "companyName": "Amphenol Corporation"
      },
      {
        "symbol": "APO",
        "companyName": "Apollo Global Management"
      },
      {
        "symbol": "ARE",
        "companyName": "Alexandria Real Estate Equities"
      },
      {
        "symbol": "ATO",
        "companyName": "Atmos Energy Corporation"
      },
      {
        "symbol": "AVB",
        "companyName": "AvalonBay Communities"
      },
      {
        "symbol": "AVY",
        "companyName": "Avery Dennison Corporation"
      },
      {
        "symbol": "AWK",
        "companyName": "American Water Works"
      },
      {
        "symbol": "AXP",
        "companyName": "American Express Company"
      },
      {
        "symbol": "BABA",
        "companyName": "Alibaba Group (US)"
      },
      {
        "symbol": "BAC",
        "companyName": "Bank of America Corp."
      },
      {
        "symbol": "BCE",
        "companyName": "BCE Inc."
      },
      {
        "symbol": "BG",
        "companyName": "Bunge Global"
      },
      {
        "symbol": "BHP",
        "companyName": "BHP Group Limited"
      },
      {
        "symbol": "BKNG",
        "companyName": "Booking Holdings Inc."
      },
      {
        "symbol": "BLK",
        "companyName": "BlackRock, Inc."
      },
      {
        "symbol": "BMY",
        "companyName": "Bristol-Myers Squibb"
      },
      {
        "symbol": "BP",
        "companyName": "BP plc"
      },
      {
        "symbol": "BRK.B",
        "companyName": "Berkshire Hathaway Inc. Class B"
      },
      {
        "symbol": "BTI",
        "companyName": "British American Tobacco ADR"
      },
      {
        "symbol": "C",
        "companyName": "Citigroup Inc."
      },
      {
        "symbol": "CAH",
        "companyName": "Cardinal Health"
      },
      {
        "symbol": "CAT",
        "companyName": "Caterpillar Inc."
      },
      {
        "symbol": "CB",
        "companyName": "Chubb Limited"
      },
      {
        "symbol": "CCI",
        "companyName": "Crown Castle Inc."
      },
      {
        "symbol": "CCL",
        "companyName": "Carnival Corporation"
      },
      {
        "symbol": "CI",
        "companyName": "Cigna Group"
      },
      {
        "symbol": "CL",
        "companyName": "Colgate-Palmolive"
      },
      {
        "symbol": "CME",
        "companyName": "CME Group Inc."
      },
      {
        "symbol": "CMI",
        "companyName": "Cummins Inc."
      },
      {
        "symbol": "CNC",
        "companyName": "Centene Corp."
      },
      {
        "symbol": "COF",
        "companyName": "Capital One Financial"
      },
      {
        "symbol": "COP",
        "companyName": "ConocoPhillips"
      },
      {
        "symbol": "COR",
        "companyName": "Cencora"
      },
      {
        "symbol": "CRM",
        "companyName": "Salesforce, Inc."
      },
      {
        "symbol": "CSCO",
        "companyName": "Cisco Systems"
      },
      {
        "symbol": "CVNA",
        "companyName": "Carvana"
      },
      {
        "symbol": "CVS",
        "companyName": "CVS Health Corp."
      },
      {
        "symbol": "CVX",
        "companyName": "Chevron Corp."
      },
      {
        "symbol": "D",
        "companyName": "Dominion Energy"
      },
      {
        "symbol": "DAL",
        "companyName": "Delta Air Lines"
      },
      {
        "symbol": "DASH",
        "companyName": "DoorDash"
      },
      {
        "symbol": "DE",
        "companyName": "Deere & Company"
      },
      {
        "symbol": "DEO",
        "companyName": "Diageo plc ADR"
      },
      {
        "symbol": "DHR",
        "companyName": "Danaher Corp."
      },
      {
        "symbol": "DIS",
        "companyName": "Walt Disney Co."
      },
      {
        "symbol": "DLR",
        "companyName": "Digital Realty Trust"
      },
      {
        "symbol": "DOV",
        "companyName": "Dover Corporation"
      },
      {
        "symbol": "ECL",
        "companyName": "Ecolab Inc."
      },
      {
        "symbol": "EL",
        "companyName": "Estee Lauder Companies"
      },
      {
        "symbol": "ELV",
        "companyName": "Elevance Health"
      },
      {
        "symbol": "EMR",
        "companyName": "Emerson Electric"
      },
      {
        "symbol": "EOG",
        "companyName": "EOG Resources"
      },
      {
        "symbol": "EQIX",
        "companyName": "Equinix, Inc."
      },
      {
        "symbol": "ETN",
        "companyName": "Eaton Corporation"
      },
      {
        "symbol": "EW",
        "companyName": "Edwards Lifesciences"
      },
      {
        "symbol": "F",
        "companyName": "Ford Motor Co."
      },
      {
        "symbol": "FCX",
        "companyName": "Freeport-McMoRan Inc."
      },
      {
        "symbol": "FDX",
        "companyName": "FedEx Corp."
      },
      {
        "symbol": "FOXA",
        "companyName": "Fox Corporation"
      },
      {
        "symbol": "GE",
        "companyName": "General Electric Co."
      },
      {
        "symbol": "GEHC",
        "companyName": "GE HealthCare Technologies"
      },
      {
        "symbol": "GEV",
        "companyName": "GE Vernova Inc."
      },
      {
        "symbol": "GIS",
        "companyName": "General Mills"
      },
      {
        "symbol": "GM",
        "companyName": "General Motors"
      },
      {
        "symbol": "GOLD",
        "companyName": "Barrick Gold Corporation"
      },
      {
        "symbol": "GS",
        "companyName": "Goldman Sachs Group"
      },
      {
        "symbol": "GSK",
        "companyName": "GSK plc"
      },
      {
        "symbol": "HAL",
        "companyName": "Halliburton Co."
      },
      {
        "symbol": "HCA",
        "companyName": "HCA Healthcare"
      },
      {
        "symbol": "HD",
        "companyName": "Home Depot Inc."
      },
      {
        "symbol": "HLT",
        "companyName": "Hilton Worldwide"
      },
      {
        "symbol": "HMC",
        "companyName": "Honda Motor Co."
      },
      {
        "symbol": "HSBC",
        "companyName": "HSBC Holdings plc"
      },
      {
        "symbol": "HSY",
        "companyName": "The Hershey Company"
      },
      {
        "symbol": "HUM",
        "companyName": "Humana Inc."
      },
      {
        "symbol": "HWM",
        "companyName": "Howmet Aerospace"
      },
      {
        "symbol": "IBM",
        "companyName": "IBM Common Stock"
      },
      {
        "symbol": "ICE",
        "companyName": "Intercontinental Exchange"
      },
      {
        "symbol": "IHG",
        "companyName": "InterContinental Hotels"
      },
      {
        "symbol": "INFY",
        "companyName": "Infosys"
      },
      {
        "symbol": "IQV",
        "companyName": "IQVIA Holdings Inc."
      },
      {
        "symbol": "IR",
        "companyName": "Ingersoll Rand"
      },
      {
        "symbol": "ITW",
        "companyName": "Illinois Tool Works"
      },
      {
        "symbol": "JNJ",
        "companyName": "Johnson & Johnson"
      },
      {
        "symbol": "JPM",
        "companyName": "JPMorgan Chase & Co."
      },
      {
        "symbol": "KO",
        "companyName": "Coca-Cola Co."
      },
      {
        "symbol": "LLY",
        "companyName": "Eli Lilly and Company"
      },
      {
        "symbol": "LMT",
        "companyName": "Lockheed Martin Corp."
      },
      {
        "symbol": "LUV",
        "companyName": "Southwest Airlines"
      },
      {
        "symbol": "LVS",
        "companyName": "Las Vegas Sands"
      },
      {
        "symbol": "LYV",
        "companyName": "Live Nation Entertainment"
      },
      {
        "symbol": "MA",
        "companyName": "Mastercard Incorporated"
      },
      {
        "symbol": "MAR",
        "companyName": "Marriott International"
      },
      {
        "symbol": "MCD",
        "companyName": "McDonald's Corp."
      },
      {
        "symbol": "MCK",
        "companyName": "McKesson Corp."
      },
      {
        "symbol": "MDLZ",
        "companyName": "Mondelez International"
      },
      {
        "symbol": "MDT",
        "companyName": "Medtronic plc"
      },
      {
        "symbol": "MET",
        "companyName": "MetLife, Inc."
      },
      {
        "symbol": "MGM",
        "companyName": "MGM Resorts"
      },
      {
        "symbol": "MMC",
        "companyName": "Marsh & McLennan Companies"
      },
      {
        "symbol": "MPC",
        "companyName": "Marathon Petroleum"
      },
      {
        "symbol": "MRK",
        "companyName": "Merck & Co., Inc."
      },
      {
        "symbol": "MS",
        "companyName": "Morgan Stanley"
      },
      {
        "symbol": "MSI",
        "companyName": "Motorola Solutions"
      },
      {
        "symbol": "MU",
        "companyName": "Micron Technology"
      },
      {
        "symbol": "NEM",
        "companyName": "Newmont Corp."
      },
      {
        "symbol": "NET",
        "companyName": "Cloudflare, Inc."
      },
      {
        "symbol": "NIO",
        "companyName": "NIO Inc."
      },
      {
        "symbol": "NKE",
        "companyName": "Nike, Inc."
      },
      {
        "symbol": "NOW",
        "companyName": "ServiceNow, Inc."
      },
      {
        "symbol": "NU",
        "companyName": "Nu Holdings Ltd."
      },
      {
        "symbol": "NUE",
        "companyName": "Nucor Corporation"
      },
      {
        "symbol": "NVO",
        "companyName": "Novo Nordisk"
      },
      {
        "symbol": "NVS",
        "companyName": "Novartis AG"
      },
      {
        "symbol": "O",
        "companyName": "Realty Income Corporation"
      },
      {
        "symbol": "ORAN",
        "companyName": "Orange S.A."
      },
      {
        "symbol": "ORCL",
        "companyName": "Oracle Corp."
      },
      {
        "symbol": "OXY",
        "companyName": "Occidental Petroleum"
      },
      {
        "symbol": "PFE",
        "companyName": "Pfizer Inc."
      },
      {
        "symbol": "PG",
        "companyName": "Procter & Gamble Co."
      },
      {
        "symbol": "PGR",
        "companyName": "Progressive Corp."
      },
      {
        "symbol": "PH",
        "companyName": "Parker-Hannifin"
      },
      {
        "symbol": "PINS",
        "companyName": "Pinterest, Inc."
      },
      {
        "symbol": "PLD",
        "companyName": "Prologis, Inc."
      },
      {
        "symbol": "PLTR",
        "companyName": "Palantir Technologies"
      },
      {
        "symbol": "PM",
        "companyName": "Philip Morris International"
      },
      {
        "symbol": "PSA",
        "companyName": "Public Storage"
      },
      {
        "symbol": "PSX",
        "companyName": "Phillips 66"
      },
      {
        "symbol": "RACE",
        "companyName": "Ferrari N.V."
      },
      {
        "symbol": "RBLX",
        "companyName": "Roblox"
      },
      {
        "symbol": "RCI",
        "companyName": "Rogers Communications Inc."
      },
      {
        "symbol": "RCL",
        "companyName": "Royal Caribbean Group"
      },
      {
        "symbol": "RIO",
        "companyName": "Rio Tinto Group"
      },
      {
        "symbol": "ROK",
        "companyName": "Rockwell Automation"
      },
      {
        "symbol": "ROKU",
        "companyName": "Roku, Inc."
      },
      {
        "symbol": "RTX",
        "companyName": "RTX Corp."
      },
      {
        "symbol": "SAP",
        "companyName": "SAP SE"
      },
      {
        "symbol": "SCCO",
        "companyName": "Southern Copper Corporation"
      },
      {
        "symbol": "SCHW",
        "companyName": "Charles Schwab Corporation"
      },
      {
        "symbol": "SHEL",
        "companyName": "Shell plc"
      },
      {
        "symbol": "SKYL",
        "companyName": "Skyline Champion Corp."
      },
      {
        "symbol": "SLB",
        "companyName": "Schlumberger N.V."
      },
      {
        "symbol": "SNAP",
        "companyName": "Snap"
      },
      {
        "symbol": "SNY",
        "companyName": "Sanofi ADR"
      },
      {
        "symbol": "SO",
        "companyName": "Southern Company"
      },
      {
        "symbol": "SONY",
        "companyName": "Sony Group"
      },
      {
        "symbol": "SPG",
        "companyName": "Simon Property Group"
      },
      {
        "symbol": "SPGI",
        "companyName": "S&P Global Inc."
      },
      {
        "symbol": "SPOT",
        "companyName": "Spotify Technology S.A."
      },
      {
        "symbol": "SQM",
        "companyName": "Sociedad Quimica y Minera"
      },
      {
        "symbol": "SRE",
        "companyName": "Sempra Energy"
      },
      {
        "symbol": "STLA",
        "companyName": "Stellantis N.V."
      },
      {
        "symbol": "SYK",
        "companyName": "Stryker Corp."
      },
      {
        "symbol": "T",
        "companyName": "AT&T Inc."
      },
      {
        "symbol": "TJX",
        "companyName": "TJX Companies"
      },
      {
        "symbol": "TM",
        "companyName": "Toyota Motor (US)"
      },
      {
        "symbol": "TMO",
        "companyName": "Thermo Fisher Scientific"
      },
      {
        "symbol": "TRI",
        "companyName": "Thomson Reuters Corp."
      },
      {
        "symbol": "TSM",
        "companyName": "Taiwan Semiconductor"
      },
      {
        "symbol": "TTE",
        "companyName": "TotalEnergies SE"
      },
      {
        "symbol": "TU",
        "companyName": "TELUS Corporation"
      },
      {
        "symbol": "UHS",
        "companyName": "Universal Health Services"
      },
      {
        "symbol": "UNH",
        "companyName": "UnitedHealth Group"
      },
      {
        "symbol": "UNP",
        "companyName": "Union Pacific Corp."
      },
      {
        "symbol": "UPS",
        "companyName": "UPS"
      },
      {
        "symbol": "USB",
        "companyName": "U.S. Bancorp"
      },
      {
        "symbol": "V",
        "companyName": "Visa Inc."
      },
      {
        "symbol": "VALE",
        "companyName": "Vale S.A."
      },
      {
        "symbol": "VLO",
        "companyName": "Valero Energy"
      },
      {
        "symbol": "VMC",
        "companyName": "Vulcan Materials Company"
      },
      {
        "symbol": "VOD",
        "companyName": "Vodafone Group Plc"
      },
      {
        "symbol": "VZ",
        "companyName": "Verizon Communications"
      },
      {
        "symbol": "WBD",
        "companyName": "Warner Bros. Discovery"
      },
      {
        "symbol": "WELL",
        "companyName": "Welltower Inc."
      },
      {
        "symbol": "WFC",
        "companyName": "Wells Fargo & Co."
      },
      {
        "symbol": "WMT",
        "companyName": "Walmart Inc."
      },
      {
        "symbol": "WPM",
        "companyName": "Wheaton Precious Metals"
      },
      {
        "symbol": "XOM",
        "companyName": "Exxon Mobil Corp."
      },
      {
        "symbol": "XPEV",
        "companyName": "XPeng Inc."
      },
      {
        "symbol": "BA",
        "companyName": "Boeing Company"
      },
      {
        "symbol": "UBER",
        "companyName": "Uber Technologies, Inc."
      },
      {
        "symbol": "CMG",
        "companyName": "Chipotle Mexican Grill, Inc."
      },
      {
        "symbol": "GD",
        "companyName": "General Dynamics Corporation"
      },
      {
        "symbol": "NOC",
        "companyName": "Northrop Grumman Corporation"
      },
      {
        "symbol": "LHX",
        "companyName": "L3Harris Technologies, Inc."
      },
      {
        "symbol": "BX",
        "companyName": "Blackstone Inc."
      },
      {
        "symbol": "KKR",
        "companyName": "KKR & Co. Inc."
      },
      {
        "symbol": "TGT",
        "companyName": "Target Corporation"
      },
      {
        "symbol": "LOW",
        "companyName": "Lowe's Companies, Inc."
      },
      {
        "symbol": "CCJ",
        "companyName": "Cameco Corporation"
      },
      {
        "symbol": "LNG",
        "companyName": "Cheniere Energy, Inc."
      },
      {
        "symbol": "DVN",
        "companyName": "Devon Energy Corporation"
      },
      {
        "symbol": "ELF",
        "companyName": "e.l.f. Beauty, Inc."
      },
      {
        "symbol": "ONON",
        "companyName": "On Holding AG"
      },
      {
        "symbol": "VRT",
        "companyName": "Vertiv Holdings Co"
      },
      {
        "symbol": "X",
        "companyName": "United States Steel Corporation"
      },
      {
        "symbol": "BK",
        "companyName": "The Bank of New York Mellon Corporation"
      },
      {
        "symbol": "STT",
        "companyName": "State Street Corporation"
      },
      {
        "symbol": "MO",
        "companyName": "Altria Group, Inc."
      },
      {
        "symbol": "TRV",
        "companyName": "The Travelers Companies, Inc."
      },
      {
        "symbol": "AFL",
        "companyName": "Aflac Incorporated"
      },
      {
        "symbol": "VST",
        "companyName": "Vistra Corp."
      },
      {
        "symbol": "WM",
        "companyName": "Waste Management, Inc."
      },
      {
        "symbol": "PWR",
        "companyName": "Quanta Services, Inc."
      },
      {
        "symbol": "DECK",
        "companyName": "Deckers Brands"
      },
      {
        "symbol": "STZ",
        "companyName": "Constellation Brands, Inc."
      },
      {
        "symbol": "NCLH",
        "companyName": "Norwegian Cruise Line Holdings Ltd."
      },
      {
        "symbol": "AMC",
        "companyName": "AMC Entertainment Holdings, Inc."
      },
      {
        "symbol": "RH",
        "companyName": "RH"
      },
      {
        "symbol": "IONQ",
        "companyName": "IonQ, Inc."
      },
      {
        "symbol": "JOBY",
        "companyName": "Joby Aviation, Inc."
      },
      {
        "symbol": "BWXT",
        "companyName": "BWX Technologies, Inc."
      },
      {
        "symbol": "SPY",
        "companyName": "SPDR S&P 500 ETF Trust"
      },
      {
        "symbol": "IWM",
        "companyName": "iShares Russell 2000 ETF"
      },
      {
        "symbol": "XLF",
        "companyName": "Financial Select Sector SPDR Fund"
      },
      {
        "symbol": "XLE",
        "companyName": "Energy Select Sector SPDR Fund"
      },
      {
        "symbol": "XLK",
        "companyName": "Technology Select Sector SPDR Fund"
      },
      {
        "symbol": "GLD",
        "companyName": "SPDR Gold Shares"
      },
      {
        "symbol": "HYG",
        "companyName": "iShares iBoxx $ High Yield Corporate Bond ETF"
      },
      {
        "symbol": "GME",
        "companyName": "GameStop Corp."
      },
      {
        "symbol": "CAG",
        "companyName": "Conagra Brands"
      },
      {
        "symbol": "CHPT",
        "companyName": "ChargePoint Holdings"
      },
      {
        "symbol": "RIG",
        "companyName": "Transocean"
      },
      {
        "symbol": "FRO",
        "companyName": "Frontline"
      },
      {
        "symbol": "TSN",
        "companyName": "Tyson Foods"
      },
      {
        "symbol": "ANDE",
        "companyName": "The Andersons"
      },
      {
        "symbol": "INGR",
        "companyName": "Ingredion"
      },
      {
        "symbol": "DAR",
        "companyName": "Darling Ingredients"
      },
      {
        "symbol": "BE",
        "companyName": "Bloom Energy"
      },
      {
        "symbol": "PL",
        "companyName": "Planet Labs"
      },
      {
        "symbol": "GSAT",
        "companyName": "Globalstar"
      },
      {
        "symbol": "XYL",
        "companyName": "Xylem"
      },
      {
        "symbol": "PNR",
        "companyName": "Pentair"
      },
      {
        "symbol": "WTRG",
        "companyName": "Essential Utilities"
      },
      {
        "symbol": "VLTO",
        "companyName": "Veralto"
      },
      {
        "symbol": "CGNX",
        "companyName": "Cognex"
      },
      {
        "symbol": "ZBRA",
        "companyName": "Zebra Technologies"
      },
      {
        "symbol": "COTY",
        "companyName": "Coty"
      },
      {
        "symbol": "NVT",
        "companyName": "nVent Electric"
      },
      {
        "symbol": "VAL",
        "companyName": "Valaris"
      },
      {
        "symbol": "NE",
        "companyName": "Noble Corporation"
      },
      {
        "symbol": "ACHR",
        "companyName": "Archer Aviation"
      },
      {
        "symbol": "KMX",
        "companyName": "CarMax"
      },
      {
        "symbol": "ZIM",
        "companyName": "ZIM Integrated Shipping"
      },
      {
        "symbol": "TXT",
        "companyName": "Textron"
      },
      {
        "symbol": "HII",
        "companyName": "Huntington Ingalls Industries"
      },
      {
        "symbol": "KTOS",
        "companyName": "Kratos Defense and Security Solutions"
      },
      {
        "symbol": "LDOS",
        "companyName": "Leidos Holdings"
      },
      {
        "symbol": "XLV",
        "companyName": "Health Care Select Sector SPDR"
      },
      {
        "symbol": "XLI",
        "companyName": "Industrial Select Sector SPDR"
      },
      {
        "symbol": "XLY",
        "companyName": "Consumer Discretionary Select Sector SPDR"
      },
      {
        "symbol": "XLP",
        "companyName": "Consumer Staples Select Sector SPDR"
      },
      {
        "symbol": "XLB",
        "companyName": "Materials Select Sector SPDR"
      },
      {
        "symbol": "XLU",
        "companyName": "Utilities Select Sector SPDR"
      },
      {
        "symbol": "XLRE",
        "companyName": "Real Estate Select Sector SPDR"
      },
      {
        "symbol": "XBI",
        "companyName": "SPDR S&P Biotech ETF"
      },
      {
        "symbol": "EWZ",
        "companyName": "iShares MSCI Brazil ETF"
      },
      {
        "symbol": "FXI",
        "companyName": "iShares China Large-Cap ETF"
      },
      {
        "symbol": "EWJ",
        "companyName": "iShares MSCI Japan ETF"
      },
      {
        "symbol": "INDA",
        "companyName": "iShares MSCI India ETF"
      },
      {
        "symbol": "EEM",
        "companyName": "iShares MSCI Emerging Markets ETF"
      },
      {
        "symbol": "VGK",
        "companyName": "Vanguard FTSE Europe ETF"
      },
      {
        "symbol": "USO",
        "companyName": "United States Oil Fund"
      },
      {
        "symbol": "SLV",
        "companyName": "iShares Silver Trust"
      },
      {
        "symbol": "DBC",
        "companyName": "Invesco DB Commodity Index Tracking Fund"
      },
      {
        "symbol": "VIXY",
        "companyName": "ProShares VIX Short-Term Futures ETF"
      }
    ]
  },
  {
    "name": "Nasdaq Stock Market (Nasdaq)",
    "stocks": [
      {
        "symbol": "AAL",
        "companyName": "American Airlines"
      },
      {
        "symbol": "AAPL",
        "companyName": "Apple Inc."
      },
      {
        "symbol": "ABNB",
        "companyName": "Airbnb, Inc."
      },
      {
        "symbol": "ACB",
        "companyName": "Aurora Cannabis"
      },
      {
        "symbol": "ADBE",
        "companyName": "Adobe Inc."
      },
      {
        "symbol": "ADI",
        "companyName": "Analog Devices, Inc."
      },
      {
        "symbol": "ADSK",
        "companyName": "Autodesk, Inc."
      },
      {
        "symbol": "ALGN",
        "companyName": "Align Technology"
      },
      {
        "symbol": "AMAT",
        "companyName": "Applied Materials"
      },
      {
        "symbol": "AMD",
        "companyName": "Advanced Micro Devices"
      },
      {
        "symbol": "AMGN",
        "companyName": "Amgen Inc."
      },
      {
        "symbol": "AMZN",
        "companyName": "Amazon.com, Inc."
      },
      {
        "symbol": "ANET",
        "companyName": "Arista Networks"
      },
      {
        "symbol": "APP",
        "companyName": "AppLovin Corp."
      },
      {
        "symbol": "ARM",
        "companyName": "Arm Holdings plc"
      },
      {
        "symbol": "ASML",
        "companyName": "ASML Holding N.V."
      },
      {
        "symbol": "AVGO",
        "companyName": "Broadcom Inc."
      },
      {
        "symbol": "AZN",
        "companyName": "AstraZeneca"
      },
      {
        "symbol": "BGEN",
        "companyName": "Biogen Inc."
      },
      {
        "symbol": "BIDU",
        "companyName": "Baidu, Inc."
      },
      {
        "symbol": "BILI",
        "companyName": "Bilibili Inc."
      },
      {
        "symbol": "BNTX",
        "companyName": "BioNTech SE"
      },
      {
        "symbol": "BYDDY",
        "companyName": "BYD Company"
      },
      {
        "symbol": "CDNS",
        "companyName": "Cadence Design Systems"
      },
      {
        "symbol": "CEG",
        "companyName": "Constellation Energy"
      },
      {
        "symbol": "CELH",
        "companyName": "Celsius Holdings"
      },
      {
        "symbol": "CGC",
        "companyName": "Canopy Growth"
      },
      {
        "symbol": "CHTR",
        "companyName": "Charter Communications"
      },
      {
        "symbol": "CMCSA",
        "companyName": "Comcast Corp."
      },
      {
        "symbol": "COIN",
        "companyName": "Coinbase"
      },
      {
        "symbol": "COST",
        "companyName": "Costco Wholesale"
      },
      {
        "symbol": "CPRT",
        "companyName": "Copart, Inc."
      },
      {
        "symbol": "CRWD",
        "companyName": "CrowdStrike Holdings"
      },
      {
        "symbol": "CSX",
        "companyName": "CSX Corp."
      },
      {
        "symbol": "CTAS",
        "companyName": "Cintas Corp."
      },
      {
        "symbol": "CTSH",
        "companyName": "Cognizant Technology"
      },
      {
        "symbol": "DDOG",
        "companyName": "Datadog, Inc."
      },
      {
        "symbol": "DLTR",
        "companyName": "Dollar Tree"
      },
      {
        "symbol": "DUOL",
        "companyName": "Duolingo"
      },
      {
        "symbol": "DXCM",
        "companyName": "DexCom, Inc."
      },
      {
        "symbol": "EA",
        "companyName": "Electronic Arts"
      },
      {
        "symbol": "EBAY",
        "companyName": "eBay Inc."
      },
      {
        "symbol": "ENPH",
        "companyName": "Enphase Energy"
      },
      {
        "symbol": "ETSY",
        "companyName": "Etsy"
      },
      {
        "symbol": "EXC",
        "companyName": "Exelon Corp."
      },
      {
        "symbol": "EXPE",
        "companyName": "Expedia Group"
      },
      {
        "symbol": "FAST",
        "companyName": "Fastenal Co."
      },
      {
        "symbol": "FISV",
        "companyName": "Fiserv Inc."
      },
      {
        "symbol": "FNKO",
        "companyName": "Funko, Inc."
      },
      {
        "symbol": "FSLR",
        "companyName": "First Solar, Inc."
      },
      {
        "symbol": "FTNT",
        "companyName": "Fortinet, Inc."
      },
      {
        "symbol": "GILD",
        "companyName": "Gilead Sciences"
      },
      {
        "symbol": "GLNCY",
        "companyName": "Glencore plc"
      },
      {
        "symbol": "GOOGL",
        "companyName": "Alphabet Inc. (Class A)"
      },
      {
        "symbol": "HON",
        "companyName": "Honeywell International"
      },
      {
        "symbol": "HOOD",
        "companyName": "Robinhood"
      },
      {
        "symbol": "IDXX",
        "companyName": "IDEXX Laboratories"
      },
      {
        "symbol": "ILMN",
        "companyName": "Illumina, Inc."
      },
      {
        "symbol": "INTC",
        "companyName": "Intel Corporation"
      },
      {
        "symbol": "INTU",
        "companyName": "Intuit Inc."
      },
      {
        "symbol": "ISRG",
        "companyName": "Intuitive Surgical"
      },
      {
        "symbol": "JAKK",
        "companyName": "JAKKS Pacific, Inc."
      },
      {
        "symbol": "JD",
        "companyName": "JD.com, Inc."
      },
      {
        "symbol": "KDP",
        "companyName": "Keurig Dr Pepper"
      },
      {
        "symbol": "KLA",
        "companyName": "KLA Corp."
      },
      {
        "symbol": "KLAC",
        "companyName": "KLA Corporation"
      },
      {
        "symbol": "LCID",
        "companyName": "Lucid Group, Inc."
      },
      {
        "symbol": "LI",
        "companyName": "Li Auto"
      },
      {
        "symbol": "LRCX",
        "companyName": "Lam Research Corp."
      },
      {
        "symbol": "LULU",
        "companyName": "Lululemon Athletica"
      },
      {
        "symbol": "LYFT",
        "companyName": "Lyft"
      },
      {
        "symbol": "MCHP",
        "companyName": "Microchip Technology"
      },
      {
        "symbol": "MDB",
        "companyName": "MongoDB, Inc."
      },
      {
        "symbol": "MELI",
        "companyName": "MercadoLibre, Inc."
      },
      {
        "symbol": "META",
        "companyName": "Meta Platforms, Inc."
      },
      {
        "symbol": "MNST",
        "companyName": "Monster Beverage"
      },
      {
        "symbol": "MPWR",
        "companyName": "Monolithic Power Systems, Inc."
      },
      {
        "symbol": "MRNA",
        "companyName": "Moderna Inc."
      },
      {
        "symbol": "MRVL",
        "companyName": "Marvell Technology"
      },
      {
        "symbol": "MSFT",
        "companyName": "Microsoft Corp."
      },
      {
        "symbol": "NCBDY",
        "companyName": "Capcom Co., Ltd. ADR"
      },
      {
        "symbol": "NFLX",
        "companyName": "Netflix, Inc."
      },
      {
        "symbol": "NSRGY",
        "companyName": "Nestle S.A."
      },
      {
        "symbol": "NTDOY",
        "companyName": "Nintendo Co., Ltd. ADR"
      },
      {
        "symbol": "NTES",
        "companyName": "NetEase, Inc."
      },
      {
        "symbol": "NVDA",
        "companyName": "NVIDIA Corp."
      },
      {
        "symbol": "NXPI",
        "companyName": "NXP Semiconductors"
      },
      {
        "symbol": "ODFL",
        "companyName": "Old Dominion Freight"
      },
      {
        "symbol": "OKTA",
        "companyName": "Okta, Inc."
      },
      {
        "symbol": "ON",
        "companyName": "ON Semiconductor Corporation"
      },
      {
        "symbol": "PANW",
        "companyName": "Palo Alto Networks"
      },
      {
        "symbol": "PAYX",
        "companyName": "Paychex, Inc."
      },
      {
        "symbol": "PCAR",
        "companyName": "PACCAR Inc."
      },
      {
        "symbol": "PDD",
        "companyName": "PDD Holdings"
      },
      {
        "symbol": "PEP",
        "companyName": "PepsiCo, Inc."
      },
      {
        "symbol": "PLBY",
        "companyName": "PLBY Group, Inc."
      },
      {
        "symbol": "PYPL",
        "companyName": "PayPal Holdings"
      },
      {
        "symbol": "QCOM",
        "companyName": "QUALCOMM Inc."
      },
      {
        "symbol": "REGN",
        "companyName": "Regeneron Pharmaceuticals, Inc."
      },
      {
        "symbol": "RHHBY",
        "companyName": "Roche Holding AG"
      },
      {
        "symbol": "RIVN",
        "companyName": "Rivian Automotive"
      },
      {
        "symbol": "ROST",
        "companyName": "Ross Stores"
      },
      {
        "symbol": "RUN",
        "companyName": "Sunrun Inc."
      },
      {
        "symbol": "RYAAY",
        "companyName": "Ryanair Holdings"
      },
      {
        "symbol": "SBUX",
        "companyName": "Starbucks Corp."
      },
      {
        "symbol": "SEDG",
        "companyName": "SolarEdge Technologies, Inc."
      },
      {
        "symbol": "SIRI",
        "companyName": "Sirius XM Holdings"
      },
      {
        "symbol": "SMCI",
        "companyName": "Super Micro Computer, Inc."
      },
      {
        "symbol": "SNDL",
        "companyName": "SNDL Inc."
      },
      {
        "symbol": "SNPS",
        "companyName": "Synopsys, Inc."
      },
      {
        "symbol": "SSNLF",
        "companyName": "Samsung Electronics"
      },
      {
        "symbol": "TCOM",
        "companyName": "Trip.com Group"
      },
      {
        "symbol": "TEAM",
        "companyName": "Atlassian Corp."
      },
      {
        "symbol": "TLRY",
        "companyName": "Tilray Brands"
      },
      {
        "symbol": "TMUS",
        "companyName": "T-Mobile US, Inc."
      },
      {
        "symbol": "TRIP",
        "companyName": "TripAdvisor, Inc."
      },
      {
        "symbol": "TSLA",
        "companyName": "Tesla, Inc."
      },
      {
        "symbol": "TTWO",
        "companyName": "Take-Two Interactive"
      },
      {
        "symbol": "TWLO",
        "companyName": "Twilio Inc."
      },
      {
        "symbol": "TXN",
        "companyName": "Texas Instruments"
      },
      {
        "symbol": "UAL",
        "companyName": "United Airlines"
      },
      {
        "symbol": "VRTX",
        "companyName": "Vertex Pharmaceuticals"
      },
      {
        "symbol": "WDAY",
        "companyName": "Workday, Inc."
      },
      {
        "symbol": "ZS",
        "companyName": "Zscaler, Inc."
      },
      {
        "symbol": "AXON",
        "companyName": "Axon Enterprise, Inc."
      },
      {
        "symbol": "FANG",
        "companyName": "Diamondback Energy, Inc."
      },
      {
        "symbol": "DKNG",
        "companyName": "DraftKings Inc."
      },
      {
        "symbol": "SOFI",
        "companyName": "SoFi Technologies, Inc."
      },
      {
        "symbol": "AFRM",
        "companyName": "Affirm Holdings, Inc."
      },
      {
        "symbol": "RKLB",
        "companyName": "Rocket Lab USA, Inc."
      },
      {
        "symbol": "MARA",
        "companyName": "MARA Holdings, Inc."
      },
      {
        "symbol": "ASTS",
        "companyName": "AST SpaceMobile, Inc."
      },
      {
        "symbol": "QQQ",
        "companyName": "Invesco QQQ Trust"
      },
      {
        "symbol": "TLT",
        "companyName": "iShares 20+ Year Treasury Bond ETF"
      },
      {
        "symbol": "SVB",
        "companyName": "SVB Financial Group"
      },
      {
        "symbol": "KHC",
        "companyName": "Kraft Heinz"
      },
      {
        "symbol": "WBA",
        "companyName": "Walgreens Boots Alliance"
      },
      {
        "symbol": "PLUG",
        "companyName": "Plug Power"
      },
      {
        "symbol": "DBX",
        "companyName": "Dropbox"
      },
      {
        "symbol": "DOCU",
        "companyName": "DocuSign"
      },
      {
        "symbol": "SBLK",
        "companyName": "Star Bulk Carriers"
      },
      {
        "symbol": "AGRO",
        "companyName": "Adecoagro"
      },
      {
        "symbol": "CSIQ",
        "companyName": "Canadian Solar"
      },
      {
        "symbol": "JKS",
        "companyName": "JinkoSolar"
      },
      {
        "symbol": "DQ",
        "companyName": "Daqo New Energy"
      },
      {
        "symbol": "ARRY",
        "companyName": "Array Technologies"
      },
      {
        "symbol": "ALNY",
        "companyName": "Alnylam Pharmaceuticals"
      },
      {
        "symbol": "CRSP",
        "companyName": "CRISPR Therapeutics"
      },
      {
        "symbol": "NTLA",
        "companyName": "Intellia Therapeutics"
      },
      {
        "symbol": "BEAM",
        "companyName": "Beam Therapeutics"
      },
      {
        "symbol": "NTRA",
        "companyName": "Natera"
      },
      {
        "symbol": "EXAS",
        "companyName": "Exact Sciences"
      },
      {
        "symbol": "TXG",
        "companyName": "10x Genomics"
      },
      {
        "symbol": "ENTG",
        "companyName": "Entegris"
      },
      {
        "symbol": "MKSI",
        "companyName": "MKS Instruments"
      },
      {
        "symbol": "TER",
        "companyName": "Teradyne"
      },
      {
        "symbol": "IRDM",
        "companyName": "Iridium Communications"
      },
      {
        "symbol": "VSAT",
        "companyName": "Viasat"
      },
      {
        "symbol": "LUNR",
        "companyName": "Intuitive Machines"
      },
      {
        "symbol": "GEN",
        "companyName": "Gen Digital"
      },
      {
        "symbol": "QLYS",
        "companyName": "Qualys"
      },
      {
        "symbol": "SYM",
        "companyName": "Symbotic"
      },
      {
        "symbol": "UAA",
        "companyName": "Under Armour"
      },
      {
        "symbol": "SKX",
        "companyName": "Skechers USA"
      },
      {
        "symbol": "EVGO",
        "companyName": "EVgo"
      },
      {
        "symbol": "BLNK",
        "companyName": "Blink Charging"
      },
      {
        "symbol": "RGTI",
        "companyName": "Rigetti Computing"
      },
      {
        "symbol": "QBTS",
        "companyName": "D-Wave Quantum"
      },
      {
        "symbol": "CART",
        "companyName": "Maplebear (Instacart)"
      },
      {
        "symbol": "U",
        "companyName": "Unity Software"
      },
      {
        "symbol": "IBKR",
        "companyName": "Interactive Brokers Group"
      },
      {
        "symbol": "UPST",
        "companyName": "Upstart Holdings"
      },
      {
        "symbol": "PENN",
        "companyName": "Penn Entertainment"
      },
      {
        "symbol": "CZR",
        "companyName": "Caesars Entertainment"
      },
      {
        "symbol": "STNE",
        "companyName": "StoneCo"
      }
    ]
  },
  {
    "name": "Shanghai Stock Exchange (SSE)",
    "stocks": [
      {
        "symbol": "600009.SS",
        "companyName": "Shanghai International Airport"
      },
      {
        "symbol": "600016.SS",
        "companyName": "China Minsheng Banking"
      },
      {
        "symbol": "600018.SS",
        "companyName": "Shanghai International Port"
      },
      {
        "symbol": "600019.SS",
        "companyName": "Baoshan Iron & Steel"
      },
      {
        "symbol": "600028.SS",
        "companyName": "Sinopec"
      },
      {
        "symbol": "600030.SS",
        "companyName": "CITIC Securities"
      },
      {
        "symbol": "600036.SS",
        "companyName": "China Merchants Bank"
      },
      {
        "symbol": "600048.SS",
        "companyName": "Poly Developments and Holdings"
      },
      {
        "symbol": "600050.SS",
        "companyName": "China United Network Communications"
      },
      {
        "symbol": "600111.SS",
        "companyName": "Northern Rare Earth"
      },
      {
        "symbol": "600276.SS",
        "companyName": "Jiangsu Hengrui Pharmaceuticals"
      },
      {
        "symbol": "600406.SS",
        "companyName": "NARI Technology"
      },
      {
        "symbol": "600438.SS",
        "companyName": "Tongwei Co."
      },
      {
        "symbol": "600519.SS",
        "companyName": "Kweichow Moutai"
      },
      {
        "symbol": "600690.SS",
        "companyName": "Haier Smart Home"
      },
      {
        "symbol": "600809.SS",
        "companyName": "Shanxi Xinghuacun Fen Wine Factory"
      },
      {
        "symbol": "600837.SS",
        "companyName": "Haitong Securities"
      },
      {
        "symbol": "600887.SS",
        "companyName": "Inner Mongolia Yili Industrial"
      },
      {
        "symbol": "600900.SS",
        "companyName": "China Yangtze Power"
      },
      {
        "symbol": "601006.SS",
        "companyName": "Daqin Railway"
      },
      {
        "symbol": "601012.SS",
        "companyName": "LONGi Green Energy Technology"
      },
      {
        "symbol": "601021.SS",
        "companyName": "Spring Airlines"
      },
      {
        "symbol": "601088.SS",
        "companyName": "China Shenhua Energy"
      },
      {
        "symbol": "601111.SS",
        "companyName": "Air China"
      },
      {
        "symbol": "601138.SS",
        "companyName": "Foxconn Industrial Internet"
      },
      {
        "symbol": "601166.SS",
        "companyName": "Industrial Bank Co."
      },
      {
        "symbol": "601186.SS",
        "companyName": "China Railway Construction"
      },
      {
        "symbol": "601211.SS",
        "companyName": "Guotai Junan Securities"
      },
      {
        "symbol": "601288.SS",
        "companyName": "Agricultural Bank of China"
      },
      {
        "symbol": "601318.SS",
        "companyName": "Ping An Insurance"
      },
      {
        "symbol": "601328.SS",
        "companyName": "Bank of Communications"
      },
      {
        "symbol": "601390.SS",
        "companyName": "China Railway Group"
      },
      {
        "symbol": "601398.SS",
        "companyName": "Industrial and Commercial Bank of China"
      },
      {
        "symbol": "601601.SS",
        "companyName": "China Pacific Insurance"
      },
      {
        "symbol": "601628.SS",
        "companyName": "China Life Insurance"
      },
      {
        "symbol": "601658.SS",
        "companyName": "Postal Savings Bank of China"
      },
      {
        "symbol": "601668.SS",
        "companyName": "China State Construction Engineering"
      },
      {
        "symbol": "601669.SS",
        "companyName": "Power Construction Corp of China"
      },
      {
        "symbol": "601688.SS",
        "companyName": "Huatai Securities"
      },
      {
        "symbol": "601766.SS",
        "companyName": "CRRC Corporation"
      },
      {
        "symbol": "601800.SS",
        "companyName": "China Communications Construction"
      },
      {
        "symbol": "601818.SS",
        "companyName": "China Everbright Bank"
      },
      {
        "symbol": "601857.SS",
        "companyName": "PetroChina"
      },
      {
        "symbol": "601888.SS",
        "companyName": "China Tourism Duty Free"
      },
      {
        "symbol": "601899.SS",
        "companyName": "Zijin Mining Group"
      },
      {
        "symbol": "601901.SS",
        "companyName": "Founder Securities"
      },
      {
        "symbol": "601919.SS",
        "companyName": "COSCO Shipping Holdings"
      },
      {
        "symbol": "601939.SS",
        "companyName": "China Construction Bank"
      },
      {
        "symbol": "601988.SS",
        "companyName": "Bank of China"
      },
      {
        "symbol": "603288.SS",
        "companyName": "Foshan Haitian Flavouring & Food"
      }
    ]
  },
  {
    "name": "Japan Exchange Group (JPX/TSE)",
    "stocks": [
      {
        "symbol": "1801.T",
        "companyName": "Taisei Corp."
      },
      {
        "symbol": "1803.T",
        "companyName": "Shimizu Corp."
      },
      {
        "symbol": "1812.T",
        "companyName": "Kajima Corp."
      },
      {
        "symbol": "1925.T",
        "companyName": "Daiwa House Industry"
      },
      {
        "symbol": "2914.T",
        "companyName": "Japan Tobacco Inc."
      },
      {
        "symbol": "3382.T",
        "companyName": "Seven & i Holdings"
      },
      {
        "symbol": "3659.T",
        "companyName": "Nexon Co., Ltd."
      },
      {
        "symbol": "4063.T",
        "companyName": "Shin-Etsu Chemical"
      },
      {
        "symbol": "4502.T",
        "companyName": "Takeda Pharmaceutical Co."
      },
      {
        "symbol": "4503.T",
        "companyName": "Astellas Pharma"
      },
      {
        "symbol": "4519.T",
        "companyName": "Chugai Pharmaceutical"
      },
      {
        "symbol": "4568.T",
        "companyName": "Daiichi Sankyo"
      },
      {
        "symbol": "4901.T",
        "companyName": "Fujifilm Holdings"
      },
      {
        "symbol": "4911.T",
        "companyName": "Shiseido Co."
      },
      {
        "symbol": "6098.T",
        "companyName": "Recruit Holdings Co."
      },
      {
        "symbol": "6273.T",
        "companyName": "SMC Corp."
      },
      {
        "symbol": "6301.T",
        "companyName": "Komatsu Ltd."
      },
      {
        "symbol": "6367.T",
        "companyName": "Daikin Industries"
      },
      {
        "symbol": "6501.T",
        "companyName": "Hitachi, Ltd."
      },
      {
        "symbol": "6503.T",
        "companyName": "Mitsubishi Electric"
      },
      {
        "symbol": "6752.T",
        "companyName": "Panasonic Holdings"
      },
      {
        "symbol": "6758.T",
        "companyName": "Sony Group Corp."
      },
      {
        "symbol": "6861.T",
        "companyName": "Keyence Corp."
      },
      {
        "symbol": "6902.T",
        "companyName": "Denso Corp."
      },
      {
        "symbol": "6920.T",
        "companyName": "Lasertec"
      },
      {
        "symbol": "6954.T",
        "companyName": "Fanuc Corp."
      },
      {
        "symbol": "6981.T",
        "companyName": "Murata Manufacturing"
      },
      {
        "symbol": "7201.T",
        "companyName": "Nissan Motor Co., Ltd."
      },
      {
        "symbol": "7203.T",
        "companyName": "Toyota Motor Corp."
      },
      {
        "symbol": "7267.T",
        "companyName": "Honda Motor Co."
      },
      {
        "symbol": "7733.T",
        "companyName": "Olympus Corp."
      },
      {
        "symbol": "7741.T",
        "companyName": "Hoya Corp."
      },
      {
        "symbol": "7832.T",
        "companyName": "Bandai Namco Holdings"
      },
      {
        "symbol": "7951.T",
        "companyName": "Yamaha Corporation"
      },
      {
        "symbol": "7952.T",
        "companyName": "Kawai Musical Instruments"
      },
      {
        "symbol": "7967.T",
        "companyName": "Bandai Co., Ltd."
      },
      {
        "symbol": "7974.T",
        "companyName": "Nintendo Co., Ltd."
      },
      {
        "symbol": "8001.T",
        "companyName": "Itochu Corp."
      },
      {
        "symbol": "8031.T",
        "companyName": "Mitsui & Co."
      },
      {
        "symbol": "8035.T",
        "companyName": "Tokyo Electron Ltd."
      },
      {
        "symbol": "8053.T",
        "companyName": "Sumitomo Corp."
      },
      {
        "symbol": "8058.T",
        "companyName": "Mitsubishi Corp."
      },
      {
        "symbol": "8306.T",
        "companyName": "Mitsubishi UFJ Financial Group"
      },
      {
        "symbol": "8316.T",
        "companyName": "Sumitomo Mitsui Financial Group"
      },
      {
        "symbol": "8411.T",
        "companyName": "Mizuho Financial Group"
      },
      {
        "symbol": "8766.T",
        "companyName": "Tokio Marine Holdings"
      },
      {
        "symbol": "8801.T",
        "companyName": "Mitsui Fudosan"
      },
      {
        "symbol": "8802.T",
        "companyName": "Mitsubishi Estate"
      },
      {
        "symbol": "9020.T",
        "companyName": "East Japan Railway Co."
      },
      {
        "symbol": "9022.T",
        "companyName": "Central Japan Railway Co."
      },
      {
        "symbol": "9101.T",
        "companyName": "Nippon Yusen Kabushiki Kaisha"
      },
      {
        "symbol": "9104.T",
        "companyName": "Mitsui O.S.K. Lines"
      },
      {
        "symbol": "9201.T",
        "companyName": "Japan Airlines"
      },
      {
        "symbol": "9202.T",
        "companyName": "ANA Holdings"
      },
      {
        "symbol": "9432.T",
        "companyName": "Nippon Telegraph and Telephone"
      },
      {
        "symbol": "9433.T",
        "companyName": "KDDI Corp."
      },
      {
        "symbol": "9684.T",
        "companyName": "Square Enix Holdings"
      },
      {
        "symbol": "9697.T",
        "companyName": "Capcom Co., Ltd."
      },
      {
        "symbol": "9766.T",
        "companyName": "Konami Group"
      },
      {
        "symbol": "9983.T",
        "companyName": "Fast Retailing Co."
      },
      {
        "symbol": "9984.T",
        "companyName": "SoftBank Group Corp."
      },
      {
        "symbol": "4661.T",
        "companyName": "Oriental Land Co., Ltd."
      },
      {
        "symbol": "4543.T",
        "companyName": "Terumo Corporation"
      },
      {
        "symbol": "6702.T",
        "companyName": "Fujitsu Limited"
      },
      {
        "symbol": "6326.T",
        "companyName": "Kubota Corporation"
      },
      {
        "symbol": "7011.T",
        "companyName": "Mitsubishi Heavy Industries, Ltd."
      },
      {
        "symbol": "8309.T",
        "companyName": "Sumitomo Mitsui Trust Holdings, Inc."
      },
      {
        "symbol": "2413.T",
        "companyName": "M3, Inc."
      },
      {
        "symbol": "6723.T",
        "companyName": "Renesas Electronics Corporation"
      },
      {
        "symbol": "9107.T",
        "companyName": "Kawasaki Kisen"
      },
      {
        "symbol": "6857.T",
        "companyName": "Advantest"
      },
      {
        "symbol": "6146.T",
        "companyName": "Disco Corporation"
      },
      {
        "symbol": "7735.T",
        "companyName": "SCREEN Holdings"
      },
      {
        "symbol": "6525.T",
        "companyName": "Kokusai Electric"
      },
      {
        "symbol": "3436.T",
        "companyName": "SUMCO"
      },
      {
        "symbol": "6506.T",
        "companyName": "Yaskawa Electric"
      },
      {
        "symbol": "6645.T",
        "companyName": "Omron"
      },
      {
        "symbol": "6594.T",
        "companyName": "Nidec"
      },
      {
        "symbol": "8750.T",
        "companyName": "Dai-ichi Life Holdings"
      },
      {
        "symbol": "8630.T",
        "companyName": "Sompo Holdings"
      },
      {
        "symbol": "8725.T",
        "companyName": "MS&AD Insurance Group"
      },
      {
        "symbol": "7012.T",
        "companyName": "Kawasaki Heavy Industries"
      },
      {
        "symbol": "7013.T",
        "companyName": "IHI Corporation"
      }
    ]
  },
  {
    "name": "Euronext & European Exchanges",
    "stocks": [
      {
        "symbol": "ABI.BR",
        "companyName": "Anheuser-Busch InBev"
      },
      {
        "symbol": "ACA.PA",
        "companyName": "Crédit Agricole S.A."
      },
      {
        "symbol": "AD.AS",
        "companyName": "Koninklijke Ahold Delhaize"
      },
      {
        "symbol": "ADYEN.AS",
        "companyName": "Adyen N.V."
      },
      {
        "symbol": "AER.IR",
        "companyName": "AerCap Holdings"
      },
      {
        "symbol": "AGEAS.BR",
        "companyName": "Ageas S.A."
      },
      {
        "symbol": "AI.PA",
        "companyName": "Air Liquide S.A."
      },
      {
        "symbol": "AIR.PA",
        "companyName": "Airbus SE"
      },
      {
        "symbol": "ALV.DE",
        "companyName": "Allianz SE"
      },
      {
        "symbol": "ASML.AS",
        "companyName": "ASML Holding N.V."
      },
      {
        "symbol": "ASRNL.AS",
        "companyName": "ASR Nederland N.V."
      },
      {
        "symbol": "BAS.DE",
        "companyName": "BASF SE"
      },
      {
        "symbol": "BAYN.DE",
        "companyName": "Bayer AG"
      },
      {
        "symbol": "BIRG.IR",
        "companyName": "Bank of Ireland Group"
      },
      {
        "symbol": "BMW.DE",
        "companyName": "Bayerische Motoren Werke AG"
      },
      {
        "symbol": "BN.PA",
        "companyName": "Danone S.A."
      },
      {
        "symbol": "BNP.PA",
        "companyName": "BNP Paribas"
      },
      {
        "symbol": "CA.PA",
        "companyName": "Carrefour S.A."
      },
      {
        "symbol": "CDI.PA",
        "companyName": "Christian Dior SE"
      },
      {
        "symbol": "CFR.SW",
        "companyName": "Richemont S.A."
      },
      {
        "symbol": "COFB.BR",
        "companyName": "Cofinimmo S.A."
      },
      {
        "symbol": "CRG.IR",
        "companyName": "CRH plc (Ireland)"
      },
      {
        "symbol": "CS.PA",
        "companyName": "AXA S.A."
      },
      {
        "symbol": "DG.PA",
        "companyName": "Vinci S.A."
      },
      {
        "symbol": "DHL.DE",
        "companyName": "Deutsche Post AG (DHL)"
      },
      {
        "symbol": "DPW.DE",
        "companyName": "Deutsche Post DHL"
      },
      {
        "symbol": "DSIR.AS",
        "companyName": "DSM-Firmenich AG"
      },
      {
        "symbol": "DSV.CO",
        "companyName": "DSV A/S"
      },
      {
        "symbol": "DSY.PA",
        "companyName": "Dassault Systèmes"
      },
      {
        "symbol": "DTE.DE",
        "companyName": "Deutsche Telekom"
      },
      {
        "symbol": "EDP.LS",
        "companyName": "EDP - Energias de Portugal"
      },
      {
        "symbol": "EDPR.LS",
        "companyName": "EDP Renováveis S.A."
      },
      {
        "symbol": "EL.PA",
        "companyName": "EssilorLuxottica"
      },
      {
        "symbol": "ENGI.PA",
        "companyName": "Engie S.A."
      },
      {
        "symbol": "ENI.MI",
        "companyName": "Eni S.p.A."
      },
      {
        "symbol": "EQNR.OL",
        "companyName": "Equinor"
      },
      {
        "symbol": "GALP.LS",
        "companyName": "Galp Energia SGPS"
      },
      {
        "symbol": "GAMES.ST",
        "companyName": "Thunderful Group AB"
      },
      {
        "symbol": "HEIA.AS",
        "companyName": "Heineken N.V."
      },
      {
        "symbol": "IBE.MC",
        "companyName": "Iberdrola"
      },
      {
        "symbol": "IFX.DE",
        "companyName": "Infineon"
      },
      {
        "symbol": "INGA.AS",
        "companyName": "ING Groep N.V."
      },
      {
        "symbol": "ITX.MC",
        "companyName": "Inditex"
      },
      {
        "symbol": "JMT.LS",
        "companyName": "Jerónimo Martins S.A."
      },
      {
        "symbol": "KBC.BR",
        "companyName": "KBC Group N.V."
      },
      {
        "symbol": "KER.PA",
        "companyName": "Kering S.A."
      },
      {
        "symbol": "KPN.AS",
        "companyName": "Koninklijke KPN"
      },
      {
        "symbol": "LVMH.PA",
        "companyName": "LVMH Moët Hennessy"
      },
      {
        "symbol": "MAERSK-B.CO",
        "companyName": "A.P. Møller - Mærsk"
      },
      {
        "symbol": "MBG.DE",
        "companyName": "Mercedes-Benz Group AG"
      },
      {
        "symbol": "MC.PA",
        "companyName": "LVMH Moët Hennessy Louis Vuitton"
      },
      {
        "symbol": "NESN.SW",
        "companyName": "Nestle S.A."
      },
      {
        "symbol": "NN.AS",
        "companyName": "NN Group N.V."
      },
      {
        "symbol": "NOS.LS",
        "companyName": "NOS, SGPS, S.A."
      },
      {
        "symbol": "NOVN.SW",
        "companyName": "Novartis AG"
      },
      {
        "symbol": "NOVOB.CO",
        "companyName": "Novo Nordisk"
      },
      {
        "symbol": "OR.PA",
        "companyName": "L'Oréal S.A."
      },
      {
        "symbol": "ORA.PA",
        "companyName": "Orange S.A."
      },
      {
        "symbol": "PHIA.AS",
        "companyName": "Koninklijke Philips"
      },
      {
        "symbol": "PRX.AS",
        "companyName": "Prosus N.V."
      },
      {
        "symbol": "RACE.MI",
        "companyName": "Ferrari N.V. (Milan)"
      },
      {
        "symbol": "RAND.AS",
        "companyName": "Randstad N.V."
      },
      {
        "symbol": "RHM.DE",
        "companyName": "Rheinmetall"
      },
      {
        "symbol": "RMS.PA",
        "companyName": "Hermès International"
      },
      {
        "symbol": "ROG.SW",
        "companyName": "Roche"
      },
      {
        "symbol": "RYA.IR",
        "companyName": "Ryanair Holdings plc"
      },
      {
        "symbol": "SAF.PA",
        "companyName": "Safran S.A."
      },
      {
        "symbol": "SAN.MC",
        "companyName": "Banco Santander S.A."
      },
      {
        "symbol": "SAN.PA",
        "companyName": "Sanofi S.A."
      },
      {
        "symbol": "SANO.PA",
        "companyName": "Sanofi S.A."
      },
      {
        "symbol": "SAP.DE",
        "companyName": "SAP SE"
      },
      {
        "symbol": "SIE.DE",
        "companyName": "Siemens AG"
      },
      {
        "symbol": "SOLB.BR",
        "companyName": "Solvay S.A."
      },
      {
        "symbol": "STM.PA",
        "companyName": "STMicroelectronics"
      },
      {
        "symbol": "SU.PA",
        "companyName": "Schneider Electric SE"
      },
      {
        "symbol": "TTE.PA",
        "companyName": "TotalEnergies SE"
      },
      {
        "symbol": "UBSG.SW",
        "companyName": "UBS Group AG"
      },
      {
        "symbol": "UCB.BR",
        "companyName": "UCB S.A."
      },
      {
        "symbol": "UMG.AS",
        "companyName": "Universal Music Group"
      },
      {
        "symbol": "UNA.AS",
        "companyName": "Unilever N.V. (Holland)"
      },
      {
        "symbol": "URW.AS",
        "companyName": "Unibail-Rodamco-Westfield"
      },
      {
        "symbol": "VALE3.SA",
        "companyName": "Vale S.A."
      },
      {
        "symbol": "VIV.PA",
        "companyName": "Vivendi SE"
      },
      {
        "symbol": "VNA.DE",
        "companyName": "Vonovia"
      },
      {
        "symbol": "VOW3.DE",
        "companyName": "Volkswagen"
      },
      {
        "symbol": "BEI.DE",
        "companyName": "Beiersdorf AG"
      },
      {
        "symbol": "SRT3.DE",
        "companyName": "Sartorius AG"
      },
      {
        "symbol": "MTX.DE",
        "companyName": "MTU Aero Engines AG"
      },
      {
        "symbol": "1COV.DE",
        "companyName": "Covestro AG"
      },
      {
        "symbol": "FRE.DE",
        "companyName": "Fresenius SE & Co. KGaA"
      },
      {
        "symbol": "ZAL.DE",
        "companyName": "Zalando SE"
      },
      {
        "symbol": "DBK.DE",
        "companyName": "Deutsche Bank AG"
      },
      {
        "symbol": "CBK.DE",
        "companyName": "Commerzbank AG"
      },
      {
        "symbol": "CAP.PA",
        "companyName": "Capgemini SE"
      },
      {
        "symbol": "SGO.PA",
        "companyName": "Compagnie de Saint-Gobain S.A."
      },
      {
        "symbol": "WLN.PA",
        "companyName": "Worldline SA"
      },
      {
        "symbol": "TEP.PA",
        "companyName": "Teleperformance SE"
      },
      {
        "symbol": "VIE.PA",
        "companyName": "Veolia Environnement S.A."
      },
      {
        "symbol": "BESI.AS",
        "companyName": "BE Semiconductor Industries N.V."
      },
      {
        "symbol": "AKZA.AS",
        "companyName": "Akzo Nobel N.V."
      },
      {
        "symbol": "AGN.AS",
        "companyName": "Aegon Ltd."
      },
      {
        "symbol": "WKL.AS",
        "companyName": "Wolters Kluwer N.V."
      },
      {
        "symbol": "CABK.MC",
        "companyName": "CaixaBank, S.A."
      },
      {
        "symbol": "REP.MC",
        "companyName": "Repsol, S.A."
      },
      {
        "symbol": "TEF.MC",
        "companyName": "Telefonica, S.A."
      },
      {
        "symbol": "UCG.MI",
        "companyName": "UniCredit S.p.A."
      },
      {
        "symbol": "ENEL.MI",
        "companyName": "Enel S.p.A."
      },
      {
        "symbol": "LDO.MI",
        "companyName": "Leonardo S.p.A."
      },
      {
        "symbol": "ISP.MI",
        "companyName": "Intesa Sanpaolo S.p.A."
      },
      {
        "symbol": "TRN.MI",
        "companyName": "Terna S.p.A."
      },
      {
        "symbol": "A2A.MI",
        "companyName": "A2A S.p.A."
      },
      {
        "symbol": "MUV2.DE",
        "companyName": "Munchener Ruckversicherungs-Gesellschaft AG (Munich Re)"
      },
      {
        "symbol": "ABBN.SW",
        "companyName": "ABB Ltd"
      },
      {
        "symbol": "ZURN.SW",
        "companyName": "Zurich Insurance Group AG"
      },
      {
        "symbol": "HLAG.DE",
        "companyName": "Hapag-Lloyd"
      },
      {
        "symbol": "VWS.CO",
        "companyName": "Vestas Wind Systems"
      },
      {
        "symbol": "NDX1.DE",
        "companyName": "Nordex"
      },
      {
        "symbol": "ARGX.BR",
        "companyName": "argenx"
      },
      {
        "symbol": "ASM.AS",
        "companyName": "ASM International"
      },
      {
        "symbol": "ETL.PA",
        "companyName": "Eutelsat"
      },
      {
        "symbol": "GEBN.SW",
        "companyName": "Geberit"
      },
      {
        "symbol": "BLND.L",
        "companyName": "British Land"
      },
      {
        "symbol": "LI.PA",
        "companyName": "Klepierre"
      },
      {
        "symbol": "GFC.PA",
        "companyName": "Gecina"
      },
      {
        "symbol": "SPSN.SW",
        "companyName": "Swiss Prime Site"
      },
      {
        "symbol": "AT1.DE",
        "companyName": "Aroundtown"
      },
      {
        "symbol": "SREN.SW",
        "companyName": "Swiss Re"
      },
      {
        "symbol": "HNR1.DE",
        "companyName": "Hannover Re"
      },
      {
        "symbol": "G.MI",
        "companyName": "Assicurazioni Generali"
      },
      {
        "symbol": "SAMPO.HE",
        "companyName": "Sampo"
      },
      {
        "symbol": "TRYG.CO",
        "companyName": "Tryg"
      },
      {
        "symbol": "AENA.MC",
        "companyName": "Aena"
      },
      {
        "symbol": "AMS.MC",
        "companyName": "Amadeus IT Group"
      },
      {
        "symbol": "CLNX.MC",
        "companyName": "Cellnex Telecom"
      },
      {
        "symbol": "NTGY.MC",
        "companyName": "Naturgy Energy"
      },
      {
        "symbol": "ELE.MC",
        "companyName": "Endesa"
      },
      {
        "symbol": "SAB.MC",
        "companyName": "Banco Sabadell"
      },
      {
        "symbol": "BKT.MC",
        "companyName": "Bankinter"
      },
      {
        "symbol": "ACS.MC",
        "companyName": "ACS Actividades de Construccion y Servicios"
      },
      {
        "symbol": "GRF.MC",
        "companyName": "Grifols"
      },
      {
        "symbol": "MAP.MC",
        "companyName": "Mapfre"
      },
      {
        "symbol": "ANA.MC",
        "companyName": "Acciona"
      },
      {
        "symbol": "RED.MC",
        "companyName": "Redeia (Red Electrica)"
      },
      {
        "symbol": "MB.MI",
        "companyName": "Mediobanca"
      },
      {
        "symbol": "BAMI.MI",
        "companyName": "Banco BPM"
      },
      {
        "symbol": "PRY.MI",
        "companyName": "Prysmian"
      },
      {
        "symbol": "MONC.MI",
        "companyName": "Moncler"
      },
      {
        "symbol": "REC.MI",
        "companyName": "Recordati"
      },
      {
        "symbol": "SRG.MI",
        "companyName": "Snam"
      },
      {
        "symbol": "PST.MI",
        "companyName": "Poste Italiane"
      },
      {
        "symbol": "CPR.MI",
        "companyName": "Davide Campari-Milano"
      },
      {
        "symbol": "NEXI.MI",
        "companyName": "Nexi"
      },
      {
        "symbol": "FBK.MI",
        "companyName": "FinecoBank"
      },
      {
        "symbol": "BMED.MI",
        "companyName": "Banca Mediolanum"
      },
      {
        "symbol": "PIRC.MI",
        "companyName": "Pirelli"
      },
      {
        "symbol": "TIT.MI",
        "companyName": "Telecom Italia"
      },
      {
        "symbol": "EGL.LS",
        "companyName": "Mota-Engil"
      },
      {
        "symbol": "SON.LS",
        "companyName": "Sonae"
      },
      {
        "symbol": "COR.LS",
        "companyName": "Corticeira Amorim"
      },
      {
        "symbol": "NVG.LS",
        "companyName": "The Navigator Company"
      },
      {
        "symbol": "SEM.LS",
        "companyName": "Semapa"
      },
      {
        "symbol": "RENE.LS",
        "companyName": "REN Redes Energeticas Nacionais"
      },
      {
        "symbol": "CTT.LS",
        "companyName": "CTT Correios de Portugal"
      },
      {
        "symbol": "KYGA.IR",
        "companyName": "Kerry Group"
      },
      {
        "symbol": "A5G.IR",
        "companyName": "AIB Group"
      },
      {
        "symbol": "GL9.IR",
        "companyName": "Glanbia"
      },
      {
        "symbol": "GBLB.BR",
        "companyName": "Groupe Bruxelles Lambert"
      },
      {
        "symbol": "UMI.BR",
        "companyName": "Umicore"
      },
      {
        "symbol": "DIE.BR",
        "companyName": "D'Ieteren Group"
      },
      {
        "symbol": "SOF.BR",
        "companyName": "Sofina"
      },
      {
        "symbol": "ACKB.BR",
        "companyName": "Ackermans and van Haaren"
      },
      {
        "symbol": "ELI.BR",
        "companyName": "Elia Group"
      },
      {
        "symbol": "SYENS.BR",
        "companyName": "Syensqo"
      },
      {
        "symbol": "LOTB.BR",
        "companyName": "Lotus Bakeries"
      },
      {
        "symbol": "MELE.BR",
        "companyName": "Melexis"
      },
      {
        "symbol": "WDP.BR",
        "companyName": "Warehouses De Pauw"
      },
      {
        "symbol": "AED.BR",
        "companyName": "Aedifica"
      },
      {
        "symbol": "MT.AS",
        "companyName": "ArcelorMittal"
      },
      {
        "symbol": "IMCD.AS",
        "companyName": "IMCD Group"
      },
      {
        "symbol": "AALB.AS",
        "companyName": "Aalberts"
      },
      {
        "symbol": "HEIO.AS",
        "companyName": "Heineken Holding"
      },
      {
        "symbol": "EXO.AS",
        "companyName": "Exor"
      },
      {
        "symbol": "ADS.DE",
        "companyName": "Adidas"
      },
      {
        "symbol": "PUM.DE",
        "companyName": "Puma"
      },
      {
        "symbol": "DHER.DE",
        "companyName": "Delivery Hero"
      },
      {
        "symbol": "HO.PA",
        "companyName": "Thales"
      },
      {
        "symbol": "AM.PA",
        "companyName": "Dassault Aviation"
      },
      {
        "symbol": "BAB.L",
        "companyName": "Babcock International Group"
      },
      {
        "symbol": "QQ.L",
        "companyName": "QinetiQ Group"
      }
    ]
  },
  {
    "name": "Shenzhen Stock Exchange (SZSE)",
    "stocks": [
      {
        "symbol": "000001.SZ",
        "companyName": "Ping An Bank"
      },
      {
        "symbol": "000002.SZ",
        "companyName": "China Vanke Co."
      },
      {
        "symbol": "000063.SZ",
        "companyName": "ZTE Corporation"
      },
      {
        "symbol": "000100.SZ",
        "companyName": "TCL Technology Group"
      },
      {
        "symbol": "000157.SZ",
        "companyName": "Zoomlion Heavy Industry"
      },
      {
        "symbol": "000333.SZ",
        "companyName": "Midea Group"
      },
      {
        "symbol": "000425.SZ",
        "companyName": "XCMG Construction Machinery"
      },
      {
        "symbol": "000538.SZ",
        "companyName": "Yunnan Baiyao Group"
      },
      {
        "symbol": "000568.SZ",
        "companyName": "Luzhou Laojiao"
      },
      {
        "symbol": "000625.SZ",
        "companyName": "Changan Automobile"
      },
      {
        "symbol": "000651.SZ",
        "companyName": "Gree Electric Appliances"
      },
      {
        "symbol": "000708.SZ",
        "companyName": "Sany Heavy Equipment"
      },
      {
        "symbol": "000725.SZ",
        "companyName": "BOE Technology Group"
      },
      {
        "symbol": "000768.SZ",
        "companyName": "AVIC Shenyang Aircraft"
      },
      {
        "symbol": "000799.SZ",
        "companyName": "Jiugui Liquor"
      },
      {
        "symbol": "000858.SZ",
        "companyName": "Wuliangye Yibin"
      },
      {
        "symbol": "000963.SZ",
        "companyName": "Livzon Pharmaceutical Group"
      },
      {
        "symbol": "002007.SZ",
        "companyName": "Hualan Biological Engineering"
      },
      {
        "symbol": "002027.SZ",
        "companyName": "Focus Media Information"
      },
      {
        "symbol": "002142.SZ",
        "companyName": "Bank of Ningbo"
      },
      {
        "symbol": "002180.SZ",
        "companyName": "Nafine Chemical"
      },
      {
        "symbol": "002230.SZ",
        "companyName": "iFlytek Co."
      },
      {
        "symbol": "002241.SZ",
        "companyName": "GoerTek Inc."
      },
      {
        "symbol": "002304.SZ",
        "companyName": "Yanghe Coal"
      },
      {
        "symbol": "002352.SZ",
        "companyName": "S.F. Holding"
      },
      {
        "symbol": "002415.SZ",
        "companyName": "Hangzhou Hikvision Digital"
      },
      {
        "symbol": "002460.SZ",
        "companyName": "Ganfeng Lithium"
      },
      {
        "symbol": "002466.SZ",
        "companyName": "Tianqi Lithium"
      },
      {
        "symbol": "002475.SZ",
        "companyName": "Luxshare Precision Industry"
      },
      {
        "symbol": "002594.SZ",
        "companyName": "BYD Company"
      },
      {
        "symbol": "300014.SZ",
        "companyName": "Eve Energy"
      },
      {
        "symbol": "300015.SZ",
        "companyName": "Aier Eye Hospital Group"
      },
      {
        "symbol": "300059.SZ",
        "companyName": "East Money Information"
      },
      {
        "symbol": "300124.SZ",
        "companyName": "Inovance Technology"
      },
      {
        "symbol": "300144.SZ",
        "companyName": "Silergy Corp (SZ)"
      },
      {
        "symbol": "300347.SZ",
        "companyName": "App privileges Bio"
      },
      {
        "symbol": "300408.SZ",
        "companyName": "Sanbiao Biologic"
      },
      {
        "symbol": "300498.SZ",
        "companyName": "Wens Foodstuff Group"
      },
      {
        "symbol": "300750.SZ",
        "companyName": "CATL (Contemporary Amperex Technology)"
      },
      {
        "symbol": "300760.SZ",
        "companyName": "Shenzhen Mindray Bio-Medical"
      }
    ]
  },
  {
    "name": "Hong Kong Exchanges (HKEX)",
    "stocks": [
      {
        "symbol": "0002.HK",
        "companyName": "CLP Holdings"
      },
      {
        "symbol": "0003.HK",
        "companyName": "Hong Kong and China Gas"
      },
      {
        "symbol": "0005.HK",
        "companyName": "HSBC Holdings plc"
      },
      {
        "symbol": "0006.HK",
        "companyName": "Power Assets Holdings"
      },
      {
        "symbol": "0011.HK",
        "companyName": "Hang Seng Bank"
      },
      {
        "symbol": "0012.HK",
        "companyName": "Henderson Land Development"
      },
      {
        "symbol": "0016.HK",
        "companyName": "Sun Hung Kai Properties"
      },
      {
        "symbol": "0017.HK",
        "companyName": "New World Development"
      },
      {
        "symbol": "0019.HK",
        "companyName": "Swire Pacific"
      },
      {
        "symbol": "0027.HK",
        "companyName": "Galaxy Entertainment Group"
      },
      {
        "symbol": "0066.HK",
        "companyName": "MTR Corporation Limited"
      },
      {
        "symbol": "0101.HK",
        "companyName": "Hang Lung Properties"
      },
      {
        "symbol": "0151.HK",
        "companyName": "Want Want China Holdings"
      },
      {
        "symbol": "0175.HK",
        "companyName": "Geely Automobile Holdings"
      },
      {
        "symbol": "0267.HK",
        "companyName": "CITIC Limited"
      },
      {
        "symbol": "0288.HK",
        "companyName": "WH Group Limited"
      },
      {
        "symbol": "0291.HK",
        "companyName": "China Resources Beer"
      },
      {
        "symbol": "0386.HK",
        "companyName": "Sinopec Corp"
      },
      {
        "symbol": "0388.HK",
        "companyName": "Hong Kong Exchanges and Clearing"
      },
      {
        "symbol": "0688.HK",
        "companyName": "China Overseas Land & Investment"
      },
      {
        "symbol": "0700.HK",
        "companyName": "Tencent Holdings Ltd."
      },
      {
        "symbol": "0823.HK",
        "companyName": "Link REIT"
      },
      {
        "symbol": "0857.HK",
        "companyName": "PetroChina Co."
      },
      {
        "symbol": "0883.HK",
        "companyName": "CNOOC Limited"
      },
      {
        "symbol": "0939.HK",
        "companyName": "China Construction Bank"
      },
      {
        "symbol": "0941.HK",
        "companyName": "China Mobile Limited"
      },
      {
        "symbol": "0960.HK",
        "companyName": "Longfor Group Holdings"
      },
      {
        "symbol": "0968.HK",
        "companyName": "Xinyi Solar Holdings"
      },
      {
        "symbol": "0992.HK",
        "companyName": "Lenovo Group Limited"
      },
      {
        "symbol": "1038.HK",
        "companyName": "CK Infrastructure Holdings"
      },
      {
        "symbol": "1044.HK",
        "companyName": "Hengan International Group"
      },
      {
        "symbol": "1088.HK",
        "companyName": "China Shenhua Energy"
      },
      {
        "symbol": "1093.HK",
        "companyName": "CSPC Pharmaceutical Group"
      },
      {
        "symbol": "1109.HK",
        "companyName": "China Resources Land"
      },
      {
        "symbol": "1113.HK",
        "companyName": "CK Asset Holdings"
      },
      {
        "symbol": "1177.HK",
        "companyName": "Sino Biopharmaceutical"
      },
      {
        "symbol": "1211.HK",
        "companyName": "BYD Company Limited"
      },
      {
        "symbol": "1299.HK",
        "companyName": "AIA Group Ltd."
      },
      {
        "symbol": "1398.HK",
        "companyName": "Industrial and Commercial Bank of China"
      },
      {
        "symbol": "1810.HK",
        "companyName": "Xiaomi Corp."
      },
      {
        "symbol": "2015.HK",
        "companyName": "Li Auto Inc."
      },
      {
        "symbol": "2018.HK",
        "companyName": "AAC Technologies"
      },
      {
        "symbol": "2318.HK",
        "companyName": "Ping An Insurance Group"
      },
      {
        "symbol": "2628.HK",
        "companyName": "China Life Insurance"
      },
      {
        "symbol": "2688.HK",
        "companyName": "ENN Energy Holdings"
      },
      {
        "symbol": "3690.HK",
        "companyName": "Meituan"
      },
      {
        "symbol": "3988.HK",
        "companyName": "Bank of China Ltd."
      },
      {
        "symbol": "700.HK",
        "companyName": "Tencent Holdings Ltd."
      },
      {
        "symbol": "9618.HK",
        "companyName": "JD.com, Inc."
      },
      {
        "symbol": "9868.HK",
        "companyName": "XPeng Inc."
      },
      {
        "symbol": "9988.HK",
        "companyName": "Alibaba Group Holding"
      },
      {
        "symbol": "2020.HK",
        "companyName": "ANTA Sports Products Limited"
      },
      {
        "symbol": "9999.HK",
        "companyName": "NetEase, Inc."
      },
      {
        "symbol": "2382.HK",
        "companyName": "Sunny Optical Technology (Group) Company Limited"
      },
      {
        "symbol": "6862.HK",
        "companyName": "Haidilao International Holding Ltd."
      },
      {
        "symbol": "2313.HK",
        "companyName": "Shenzhou International Group Holdings Limited"
      },
      {
        "symbol": "1928.HK",
        "companyName": "Sands China Ltd."
      },
      {
        "symbol": "3968.HK",
        "companyName": "China Merchants Bank Co., Ltd."
      }
    ]
  },
  {
    "name": "National Stock Exchange of India (NSE)",
    "stocks": [
      {
        "symbol": "ADANIENT.NS",
        "companyName": "Adani Enterprises"
      },
      {
        "symbol": "ADANIPORTS.NS",
        "companyName": "Adani Ports & SEZ"
      },
      {
        "symbol": "ADANIPOWER.NS",
        "companyName": "Adani Power"
      },
      {
        "symbol": "APOLLOHOSP.NS",
        "companyName": "Apollo Hospitals"
      },
      {
        "symbol": "ASIANPAINT.NS",
        "companyName": "Asian Paints"
      },
      {
        "symbol": "AXISBANK.NS",
        "companyName": "Axis Bank"
      },
      {
        "symbol": "BAJAJ-AUTO.NS",
        "companyName": "Bajaj Auto"
      },
      {
        "symbol": "BAJFINANCE.NS",
        "companyName": "Bajaj Finance"
      },
      {
        "symbol": "BHARTIARTL.NS",
        "companyName": "Bharti Airtel"
      },
      {
        "symbol": "BPCL.NS",
        "companyName": "Bharat Petroleum"
      },
      {
        "symbol": "BRITANNIA.NS",
        "companyName": "Britannia Industries"
      },
      {
        "symbol": "CIPLA.NS",
        "companyName": "Cipla"
      },
      {
        "symbol": "COALINDIA.NS",
        "companyName": "Coal India"
      },
      {
        "symbol": "DIVISLAB.NS",
        "companyName": "Divi's Laboratories"
      },
      {
        "symbol": "DRREDDY.NS",
        "companyName": "Dr. Reddy's Laboratories"
      },
      {
        "symbol": "EICHERMOT.NS",
        "companyName": "Eicher Motors"
      },
      {
        "symbol": "GRASIM.NS",
        "companyName": "Grasim Industries"
      },
      {
        "symbol": "HCLTECH.NS",
        "companyName": "HCL Technologies"
      },
      {
        "symbol": "HDFCBANK.NS",
        "companyName": "HDFC Bank"
      },
      {
        "symbol": "HDFCLIFE.NS",
        "companyName": "HDFC Life Insurance"
      },
      {
        "symbol": "HEROMOTOCO.NS",
        "companyName": "Hero MotoCorp"
      },
      {
        "symbol": "HINDALCO.NS",
        "companyName": "Hindalco Industries"
      },
      {
        "symbol": "HINDUNILVR.NS",
        "companyName": "Hindustan Unilever"
      },
      {
        "symbol": "ICICIBANK.NS",
        "companyName": "ICICI Bank"
      },
      {
        "symbol": "INDUSINDBK.NS",
        "companyName": "IndusInd Bank"
      },
      {
        "symbol": "INFY.NS",
        "companyName": "Infosys"
      },
      {
        "symbol": "ITC.NS",
        "companyName": "ITC Limited"
      },
      {
        "symbol": "JIOFIN.NS",
        "companyName": "Jio Financial Services"
      },
      {
        "symbol": "JSWSTEEL.NS",
        "companyName": "JSW Steel"
      },
      {
        "symbol": "KOTAKBANK.NS",
        "companyName": "Kotak Mahindra Bank"
      },
      {
        "symbol": "LT.NS",
        "companyName": "Larsen & Toubro"
      },
      {
        "symbol": "LTIM.NS",
        "companyName": "LTIMindtree"
      },
      {
        "symbol": "M&M.NS",
        "companyName": "Mahindra & Mahindra"
      },
      {
        "symbol": "MARUTI.NS",
        "companyName": "Maruti Suzuki India"
      },
      {
        "symbol": "NESTLEIND.NS",
        "companyName": "Nestle India"
      },
      {
        "symbol": "NTPC.NS",
        "companyName": "NTPC Limited"
      },
      {
        "symbol": "ONGC.NS",
        "companyName": "Oil & Natural Gas Corp"
      },
      {
        "symbol": "POWERGRID.NS",
        "companyName": "Power Grid Corp of India"
      },
      {
        "symbol": "RELIANCE.NS",
        "companyName": "Reliance Industries"
      },
      {
        "symbol": "SBI.NS",
        "companyName": "State Bank of India"
      },
      {
        "symbol": "SBILIFE.NS",
        "companyName": "SBI Life Insurance"
      },
      {
        "symbol": "SHRIRAMFIN.NS",
        "companyName": "Shriram Finance"
      },
      {
        "symbol": "SUNPHARMA.NS",
        "companyName": "Sun Pharmaceutical Industries"
      },
      {
        "symbol": "TATACONSUM.NS",
        "companyName": "Tata Consumer Products"
      },
      {
        "symbol": "TATAMOTORS.NS",
        "companyName": "Tata Motors"
      },
      {
        "symbol": "TATASTEEL.NS",
        "companyName": "Tata Steel"
      },
      {
        "symbol": "TCS.NS",
        "companyName": "Tata Consultancy Services"
      },
      {
        "symbol": "TITAN.NS",
        "companyName": "Titan Company"
      },
      {
        "symbol": "ULTRACEMCO.NS",
        "companyName": "UltraTech Cement"
      },
      {
        "symbol": "WIPRO.NS",
        "companyName": "Wipro"
      },
      {
        "symbol": "DMART.NS",
        "companyName": "Avenue Supermarts Limited"
      },
      {
        "symbol": "ZOMATO.NS",
        "companyName": "Eternal Limited (Zomato)"
      },
      {
        "symbol": "PAYTM.NS",
        "companyName": "One97 Communications Limited"
      },
      {
        "symbol": "IRCTC.NS",
        "companyName": "Indian Railway Catering and Tourism Corporation Limited"
      },
      {
        "symbol": "NYKAA.NS",
        "companyName": "FSN E-Commerce Ventures Limited"
      },
      {
        "symbol": "LICI.NS",
        "companyName": "Life Insurance Corporation of India"
      },
      {
        "symbol": "SWIGGY.NS",
        "companyName": "Swiggy"
      },
      {
        "symbol": "HAL.NS",
        "companyName": "Hindustan Aeronautics"
      },
      {
        "symbol": "BEL.NS",
        "companyName": "Bharat Electronics"
      }
    ]
  },
  {
    "name": "London Stock Exchange (LSE)",
    "stocks": [
      {
        "symbol": "3I.L",
        "companyName": "3i Group plc"
      },
      {
        "symbol": "AAL.L",
        "companyName": "Anglo American plc"
      },
      {
        "symbol": "ABF.L",
        "companyName": "Associated British Foods"
      },
      {
        "symbol": "ADM.L",
        "companyName": "Admiral Group"
      },
      {
        "symbol": "ALW.L",
        "companyName": "Alliance Trust plc"
      },
      {
        "symbol": "ANTO.L",
        "companyName": "Antofagasta plc"
      },
      {
        "symbol": "AUTO.L",
        "companyName": "Auto Trader Group"
      },
      {
        "symbol": "AV.L",
        "companyName": "Aviva plc"
      },
      {
        "symbol": "AZN.L",
        "companyName": "AstraZeneca"
      },
      {
        "symbol": "BAES.L",
        "companyName": "BAE Systems"
      },
      {
        "symbol": "BARC.L",
        "companyName": "Barclays"
      },
      {
        "symbol": "BATS.L",
        "companyName": "British American Tobacco"
      },
      {
        "symbol": "BBOX.L",
        "companyName": "Triton Big Box REIT plc"
      },
      {
        "symbol": "BBY.L",
        "companyName": "Balfour Beatty"
      },
      {
        "symbol": "BDEV.L",
        "companyName": "Barratt Developments"
      },
      {
        "symbol": "BEZ.L",
        "companyName": "Beazley plc"
      },
      {
        "symbol": "BKG.L",
        "companyName": "Berkeley Group Holdings"
      },
      {
        "symbol": "BME.L",
        "companyName": "B&M European Value Retail"
      },
      {
        "symbol": "BNZL.L",
        "companyName": "Bunzl plc"
      },
      {
        "symbol": "BP.L",
        "companyName": "BP plc"
      },
      {
        "symbol": "BRBY.L",
        "companyName": "Burberry Group"
      },
      {
        "symbol": "BT-A.L",
        "companyName": "BT Group"
      },
      {
        "symbol": "CBG.L",
        "companyName": "Close Brothers Group plc"
      },
      {
        "symbol": "CNA.L",
        "companyName": "Centrica plc"
      },
      {
        "symbol": "COA.L",
        "companyName": "Coats Group"
      },
      {
        "symbol": "CPG.L",
        "companyName": "Compass Group"
      },
      {
        "symbol": "CPH.L",
        "companyName": "Compass Group plc"
      },
      {
        "symbol": "CRDA.L",
        "companyName": "Croda International"
      },
      {
        "symbol": "CTEC.L",
        "companyName": "Convatec Group"
      },
      {
        "symbol": "DCC.L",
        "companyName": "DCC plc"
      },
      {
        "symbol": "DGE.L",
        "companyName": "Diageo plc"
      },
      {
        "symbol": "DLG.L",
        "companyName": "Direct Line Insurance"
      },
      {
        "symbol": "DPLM.L",
        "companyName": "Diplomat plc"
      },
      {
        "symbol": "EDV.L",
        "companyName": "Endeavour Mining"
      },
      {
        "symbol": "ENT.L",
        "companyName": "Entain plc"
      },
      {
        "symbol": "EXPN.L",
        "companyName": "Experian plc"
      },
      {
        "symbol": "FLTR.L",
        "companyName": "Flutter Entertainment"
      },
      {
        "symbol": "FRAS.L",
        "companyName": "Frasers Group plc"
      },
      {
        "symbol": "FRES.L",
        "companyName": "Fresnillo plc"
      },
      {
        "symbol": "FRNT.L",
        "companyName": "Frontier Developments plc"
      },
      {
        "symbol": "GAW.L",
        "companyName": "Games Workshop Group plc"
      },
      {
        "symbol": "GLEN.L",
        "companyName": "Glencore plc"
      },
      {
        "symbol": "GRG.L",
        "companyName": "Greggs plc"
      },
      {
        "symbol": "GSK.L",
        "companyName": "GSK plc"
      },
      {
        "symbol": "HBR.L",
        "companyName": "Harbour Energy"
      },
      {
        "symbol": "HIK.L",
        "companyName": "Hikma Pharmaceuticals"
      },
      {
        "symbol": "HLMA.L",
        "companyName": "Halma plc"
      },
      {
        "symbol": "HLN.L",
        "companyName": "Haleon plc"
      },
      {
        "symbol": "HSBA.L",
        "companyName": "HSBC Holdings"
      },
      {
        "symbol": "HSX.L",
        "companyName": "Hiscox Ltd"
      },
      {
        "symbol": "HWD.L",
        "companyName": "Howden Joinery Group"
      },
      {
        "symbol": "IAG.L",
        "companyName": "International Consolidated Airlines"
      },
      {
        "symbol": "ICP.L",
        "companyName": "Intermediate Capital Group"
      },
      {
        "symbol": "IHG.L",
        "companyName": "InterContinental Hotels"
      },
      {
        "symbol": "IHT.L",
        "companyName": "International Hotel Investments plc"
      },
      {
        "symbol": "III.L",
        "companyName": "3i Group plc"
      },
      {
        "symbol": "IMB.L",
        "companyName": "Imperial Brands"
      },
      {
        "symbol": "IMI.L",
        "companyName": "IMI plc"
      },
      {
        "symbol": "INDV.L",
        "companyName": "Indivior plc"
      },
      {
        "symbol": "INF.L",
        "companyName": "Informa plc"
      },
      {
        "symbol": "ITRK.L",
        "companyName": "Intertek Group"
      },
      {
        "symbol": "ITV.L",
        "companyName": "ITV plc"
      },
      {
        "symbol": "JD.L",
        "companyName": "JD Sports Fashion"
      },
      {
        "symbol": "JET.L",
        "companyName": "Just Eat Takeaway"
      },
      {
        "symbol": "JMAT.L",
        "companyName": "Johnson Matthey plc"
      },
      {
        "symbol": "KGF.L",
        "companyName": "Kingfisher plc"
      },
      {
        "symbol": "LAND.L",
        "companyName": "Land Securities Group"
      },
      {
        "symbol": "LGEN.L",
        "companyName": "Legal & General Group"
      },
      {
        "symbol": "LLOY.L",
        "companyName": "Lloyds Banking Group"
      },
      {
        "symbol": "LMP.L",
        "companyName": "LondonMetric Property plc"
      },
      {
        "symbol": "LSEG.L",
        "companyName": "London Stock Exchange Group"
      },
      {
        "symbol": "MKS.L",
        "companyName": "Marks & Spencer"
      },
      {
        "symbol": "MNDI.L",
        "companyName": "Mondi plc"
      },
      {
        "symbol": "MNG.L",
        "companyName": "M&G plc"
      },
      {
        "symbol": "MRO.L",
        "companyName": "Melrose Industries"
      },
      {
        "symbol": "NG.L",
        "companyName": "National Grid"
      },
      {
        "symbol": "NWG.L",
        "companyName": "NatWest Group"
      },
      {
        "symbol": "NXT.L",
        "companyName": "Next plc"
      },
      {
        "symbol": "OCDO.L",
        "companyName": "Ocado Group"
      },
      {
        "symbol": "PHNX.L",
        "companyName": "Phoenix Group Holdings"
      },
      {
        "symbol": "PNN.L",
        "companyName": "Pennon Group"
      },
      {
        "symbol": "PRU.L",
        "companyName": "Prudential plc"
      },
      {
        "symbol": "PSH.L",
        "companyName": "Pershing Square Holdings Ltd"
      },
      {
        "symbol": "PSN.L",
        "companyName": "Persimmon plc"
      },
      {
        "symbol": "PSON.L",
        "companyName": "Pearson plc"
      },
      {
        "symbol": "RDW.L",
        "companyName": "Redrow plc"
      },
      {
        "symbol": "REL.L",
        "companyName": "RELX plc"
      },
      {
        "symbol": "RIO.L",
        "companyName": "Rio Tinto"
      },
      {
        "symbol": "RKT.L",
        "companyName": "Reckitt Benckiser Group"
      },
      {
        "symbol": "RMV.L",
        "companyName": "Rightmove plc"
      },
      {
        "symbol": "RR.L",
        "companyName": "Rolls-Royce Holdings"
      },
      {
        "symbol": "RS1.L",
        "companyName": "RS Group plc"
      },
      {
        "symbol": "RTO.L",
        "companyName": "Rentokil Initial plc"
      },
      {
        "symbol": "SBRY.L",
        "companyName": "J Sainsbury plc"
      },
      {
        "symbol": "SDR.L",
        "companyName": "Schroders plc"
      },
      {
        "symbol": "SGE.L",
        "companyName": "Sage Group"
      },
      {
        "symbol": "SGRO.L",
        "companyName": "SEGRO plc"
      },
      {
        "symbol": "SHEL.L",
        "companyName": "Shell plc"
      },
      {
        "symbol": "SMIN.L",
        "companyName": "Smiths Group plc"
      },
      {
        "symbol": "SMT.L",
        "companyName": "Scottish Mortgage Investment Trust plc"
      },
      {
        "symbol": "SN.L",
        "companyName": "Smith & Nephew"
      },
      {
        "symbol": "SPGP.L",
        "companyName": "Spectris plc"
      },
      {
        "symbol": "SPX.L",
        "companyName": "Spirax Group plc"
      },
      {
        "symbol": "SSE.L",
        "companyName": "SSE plc"
      },
      {
        "symbol": "STAN.L",
        "companyName": "Standard Chartered"
      },
      {
        "symbol": "STJ.L",
        "companyName": "St. James's Place plc"
      },
      {
        "symbol": "SVT.L",
        "companyName": "Severn Trent"
      },
      {
        "symbol": "TSCO.L",
        "companyName": "Tesco plc"
      },
      {
        "symbol": "TW.L",
        "companyName": "Taylor Wimpey"
      },
      {
        "symbol": "ULVR.L",
        "companyName": "Unilever plc"
      },
      {
        "symbol": "UTG.L",
        "companyName": "Unite Group plc"
      },
      {
        "symbol": "UU.L",
        "companyName": "United Utilities"
      },
      {
        "symbol": "VOD.L",
        "companyName": "Vodafone Group"
      },
      {
        "symbol": "VTY.L",
        "companyName": "Vistry Group"
      },
      {
        "symbol": "WEIR.L",
        "companyName": "Weir Group"
      },
      {
        "symbol": "WPP.L",
        "companyName": "WPP plc"
      },
      {
        "symbol": "WTB.L",
        "companyName": "Whitbread plc"
      },
      {
        "symbol": "AHT.L",
        "companyName": "Ashtead Group plc"
      },
      {
        "symbol": "HL.L",
        "companyName": "Hargreaves Lansdown plc"
      },
      {
        "symbol": "HWDN.L",
        "companyName": "Howden Joinery Group plc"
      },
      {
        "symbol": "FERG.L",
        "companyName": "Ferguson plc"
      },
      {
        "symbol": "WH.L",
        "companyName": "Whitbread plc"
      },
      {
        "symbol": "CCH.L",
        "companyName": "Coca-Cola HBC AG"
      },
      {
        "symbol": "WISE.L",
        "companyName": "Wise plc"
      },
      {
        "symbol": "EZJ.L",
        "companyName": "easyJet plc"
      },
      {
        "symbol": "TUI.L",
        "companyName": "TUI AG"
      },
      {
        "symbol": "WIZZ.L",
        "companyName": "Wizz Air Holdings plc"
      },
      {
        "symbol": "CINE.L",
        "companyName": "Cineworld Group plc"
      },
      {
        "symbol": "BOO.L",
        "companyName": "boohoo group plc"
      },
      {
        "symbol": "ASC.L",
        "companyName": "ASOS plc"
      },
      {
        "symbol": "THG.L",
        "companyName": "THG plc"
      },
      {
        "symbol": "TATE.L",
        "companyName": "Tate and Lyle"
      }
    ]
  },
  {
    "name": "Bombay Stock Exchange (BSE)",
    "stocks": [
      {
        "symbol": "500049.BO",
        "companyName": "BHEL (BSE)"
      },
      {
        "symbol": "500112.BO",
        "companyName": "State Bank of India (BSE)"
      },
      {
        "symbol": "500114.BO",
        "companyName": "Titan Company Ltd (BSE)"
      },
      {
        "symbol": "500124.BO",
        "companyName": "DR.REDDY'S LABORATORIES (BSE)"
      },
      {
        "symbol": "500180.BO",
        "companyName": "HDFC Bank Ltd (BSE)"
      },
      {
        "symbol": "500182.BO",
        "companyName": "HERO MOTOCORP (BSE)"
      },
      {
        "symbol": "500209.BO",
        "companyName": "Infosys Ltd (BSE)"
      },
      {
        "symbol": "500247.BO",
        "companyName": "Kotak Mahindra Bank (BSE)"
      },
      {
        "symbol": "500266.BO",
        "companyName": "MAHINDRA & MAHINDRA (BSE)"
      },
      {
        "symbol": "500295.BO",
        "companyName": "VEDANTA LTD (BSE)"
      },
      {
        "symbol": "500325.BO",
        "companyName": "Reliance Industries Ltd (BSE)"
      },
      {
        "symbol": "500387.BO",
        "companyName": "SHREE CEMENT LTD (BSE)"
      },
      {
        "symbol": "500420.BO",
        "companyName": "TATA MOTORS LTD (BSE)"
      },
      {
        "symbol": "500470.BO",
        "companyName": "TATA STEEL LTD (BSE)"
      },
      {
        "symbol": "500510.BO",
        "companyName": "Larsen & Toubro Ltd (BSE)"
      },
      {
        "symbol": "500520.BO",
        "companyName": "M&M FINANCIAL (BSE)"
      },
      {
        "symbol": "500696.BO",
        "companyName": "Hindustan Unilever Ltd (BSE)"
      },
      {
        "symbol": "500820.BO",
        "companyName": "Asian Paints Ltd (BSE)"
      },
      {
        "symbol": "507685.BO",
        "companyName": "Wipro Ltd (BSE)"
      },
      {
        "symbol": "524715.BO",
        "companyName": "Sun Pharmaceutical (BSE)"
      },
      {
        "symbol": "532155.BO",
        "companyName": "GAIL (INDIA) LTD (BSE)"
      },
      {
        "symbol": "532174.BO",
        "companyName": "ICICI Bank Ltd (BSE)"
      },
      {
        "symbol": "532215.BO",
        "companyName": "Axis Bank Ltd (BSE)"
      },
      {
        "symbol": "532461.BO",
        "companyName": "PUNJAB NATIONAL BANK (BSE)"
      },
      {
        "symbol": "532488.BO",
        "companyName": "DIVI'S LABORATORIES (BSE)"
      },
      {
        "symbol": "532500.BO",
        "companyName": "Maruti Suzuki India (BSE)"
      },
      {
        "symbol": "532540.BO",
        "companyName": "Tata Consultancy Services (BSE)"
      },
      {
        "symbol": "532755.BO",
        "companyName": "TECH MAHINDRA (BSE)"
      },
      {
        "symbol": "532898.BO",
        "companyName": "POWER GRID CORP (BSE)"
      },
      {
        "symbol": "533096.BO",
        "companyName": "ADANI PORTS (BSE)"
      },
      {
        "symbol": "533278.BO",
        "companyName": "COAL INDIA LTD (BSE)"
      }
    ]
  },
  {
    "name": "Toronto Stock Exchange (TSX)",
    "stocks": [
      {
        "symbol": "ABX.TO",
        "companyName": "Barrick Gold"
      },
      {
        "symbol": "AC.TO",
        "companyName": "Air Canada"
      },
      {
        "symbol": "AEM.TO",
        "companyName": "Agnico Eagle Mines"
      },
      {
        "symbol": "AQN.TO",
        "companyName": "Algonquin Power & Utilities"
      },
      {
        "symbol": "ATD.TO",
        "companyName": "Alimentation Couche-Tard"
      },
      {
        "symbol": "ATRL.TO",
        "companyName": "AtkinsRéalis Group"
      },
      {
        "symbol": "BAM.TO",
        "companyName": "Brookfield Asset Management"
      },
      {
        "symbol": "BCE.TO",
        "companyName": "BCE Inc."
      },
      {
        "symbol": "BEP-UN.TO",
        "companyName": "Brookfield Renewable Partners"
      },
      {
        "symbol": "BIP-UN.TO",
        "companyName": "Brookfield Infrastructure Partners"
      },
      {
        "symbol": "BMO.TO",
        "companyName": "Bank of Montreal"
      },
      {
        "symbol": "BN.TO",
        "companyName": "Brookfield Corporation"
      },
      {
        "symbol": "BNS.TO",
        "companyName": "Bank of Nova Scotia"
      },
      {
        "symbol": "BTO.TO",
        "companyName": "B2Gold Corp."
      },
      {
        "symbol": "CAE.TO",
        "companyName": "CAE Inc."
      },
      {
        "symbol": "CAR-UN.TO",
        "companyName": "Canadian Apartment Properties REIT"
      },
      {
        "symbol": "CCO.TO",
        "companyName": "Cameco Corporation"
      },
      {
        "symbol": "CIGI.TO",
        "companyName": "Colliers International Group"
      },
      {
        "symbol": "CM.TO",
        "companyName": "Canadian Imperial Bank of Commerce"
      },
      {
        "symbol": "CNQ.TO",
        "companyName": "Canadian Natural Resources"
      },
      {
        "symbol": "CNR.TO",
        "companyName": "Canadian National Railway"
      },
      {
        "symbol": "CP.TO",
        "companyName": "Canadian Pacific Kansas City"
      },
      {
        "symbol": "CSU.TO",
        "companyName": "Constellation Software"
      },
      {
        "symbol": "CTC-A.TO",
        "companyName": "Canadian Tire Corporation"
      },
      {
        "symbol": "CVE.TO",
        "companyName": "Cenovus Energy"
      },
      {
        "symbol": "DOL.TO",
        "companyName": "Dollarama Inc."
      },
      {
        "symbol": "DOO.TO",
        "companyName": "BRP Inc."
      },
      {
        "symbol": "DSG.TO",
        "companyName": "Descartes Systems Group"
      },
      {
        "symbol": "EMA.TO",
        "companyName": "Emera Inc."
      },
      {
        "symbol": "ENB.TO",
        "companyName": "Enbridge Inc."
      },
      {
        "symbol": "FM.TO",
        "companyName": "First Quantum Minerals"
      },
      {
        "symbol": "FN.TO",
        "companyName": "First National Financial"
      },
      {
        "symbol": "FNV.TO",
        "companyName": "Franco-Nevada Corporation"
      },
      {
        "symbol": "FSV.TO",
        "companyName": "FirstService Corporation"
      },
      {
        "symbol": "FTS.TO",
        "companyName": "Fortis Inc."
      },
      {
        "symbol": "GIB-A.TO",
        "companyName": "CGI Inc."
      },
      {
        "symbol": "GIL.TO",
        "companyName": "Gildan Activewear"
      },
      {
        "symbol": "GWO.TO",
        "companyName": "Great-West Lifeco"
      },
      {
        "symbol": "H.TO",
        "companyName": "Hydro One Ltd."
      },
      {
        "symbol": "IFC.TO",
        "companyName": "Intact Financial Corporation"
      },
      {
        "symbol": "IMO.TO",
        "companyName": "Imperial Oil"
      },
      {
        "symbol": "K.TO",
        "companyName": "Kinross Gold"
      },
      {
        "symbol": "KXS.TO",
        "companyName": "Kinaxis Inc."
      },
      {
        "symbol": "L.TO",
        "companyName": "Loblaw Companies"
      },
      {
        "symbol": "LSPD.TO",
        "companyName": "Lightspeed Commerce"
      },
      {
        "symbol": "MFC.TO",
        "companyName": "Manulife Financial"
      },
      {
        "symbol": "MG.TO",
        "companyName": "Magna International Inc."
      },
      {
        "symbol": "MRU.TO",
        "companyName": "Metro Inc."
      },
      {
        "symbol": "NA.TO",
        "companyName": "National Bank of Canada"
      },
      {
        "symbol": "NTR.TO",
        "companyName": "Nutrien Ltd."
      },
      {
        "symbol": "OTEX.TO",
        "companyName": "Open Text Corporation"
      },
      {
        "symbol": "POW.TO",
        "companyName": "Power Corporation of Canada"
      },
      {
        "symbol": "PPL.TO",
        "companyName": "Pembina Pipeline"
      },
      {
        "symbol": "QSR.TO",
        "companyName": "Restaurant Brands International"
      },
      {
        "symbol": "RY.TO",
        "companyName": "Royal Bank of Canada"
      },
      {
        "symbol": "SAP.TO",
        "companyName": "Saputo Inc."
      },
      {
        "symbol": "SHOP.TO",
        "companyName": "Shopify Inc."
      },
      {
        "symbol": "SLF.TO",
        "companyName": "Sun Life Financial"
      },
      {
        "symbol": "SU.TO",
        "companyName": "Suncor Energy"
      },
      {
        "symbol": "TD.TO",
        "companyName": "Toronto-Dominion Bank"
      },
      {
        "symbol": "TECK-B.TO",
        "companyName": "Teck Resources Ltd"
      },
      {
        "symbol": "TELUS.TO",
        "companyName": "Telus Corporation"
      },
      {
        "symbol": "TFII.TO",
        "companyName": "TFI International"
      },
      {
        "symbol": "TIH.TO",
        "companyName": "Toromont Industries Ltd."
      },
      {
        "symbol": "TOU.TO",
        "companyName": "Tourmaline Oil Corp"
      },
      {
        "symbol": "TOY.TO",
        "companyName": "Spin Master Corp."
      },
      {
        "symbol": "TRI.TO",
        "companyName": "Thomson Reuters"
      },
      {
        "symbol": "TRP.TO",
        "companyName": "TC Energy Corp"
      },
      {
        "symbol": "WCN.TO",
        "companyName": "Waste Connections"
      },
      {
        "symbol": "WN.TO",
        "companyName": "George Weston Ltd."
      },
      {
        "symbol": "WPM.TO",
        "companyName": "Wheaton Precious Metals"
      },
      {
        "symbol": "WSP.TO",
        "companyName": "WSP Global Inc."
      },
      {
        "symbol": "WTE.TO",
        "companyName": "Westshore Terminals"
      },
      {
        "symbol": "PKI.TO",
        "companyName": "Parkland Corporation"
      },
      {
        "symbol": "WFG.TO",
        "companyName": "West Fraser Timber Co. Ltd."
      },
      {
        "symbol": "ERO.TO",
        "companyName": "Ero Copper Corp."
      },
      {
        "symbol": "PAAS.TO",
        "companyName": "Pan American Silver Corp."
      },
      {
        "symbol": "HBM.TO",
        "companyName": "Hudbay Minerals Inc."
      },
      {
        "symbol": "IGM.TO",
        "companyName": "IGM Financial Inc."
      }
    ]
  },
  {
    "name": "Australian Securities Exchange (ASX)",
    "stocks": [
      {
        "symbol": "ALL.AX",
        "companyName": "Aristocrat Leisure"
      },
      {
        "symbol": "ALQ.AX",
        "companyName": "ALS Limited"
      },
      {
        "symbol": "AMC.AX",
        "companyName": "Amcor plc"
      },
      {
        "symbol": "ANZ.AX",
        "companyName": "ANZ Group Holdings"
      },
      {
        "symbol": "APA.AX",
        "companyName": "APA Group"
      },
      {
        "symbol": "ASX.AX",
        "companyName": "ASX Limited"
      },
      {
        "symbol": "BHP.AX",
        "companyName": "BHP Group"
      },
      {
        "symbol": "BSL.AX",
        "companyName": "BlueScope Steel"
      },
      {
        "symbol": "BXB.AX",
        "companyName": "Brambles Limited"
      },
      {
        "symbol": "CAR.AX",
        "companyName": "carsales.com Limited"
      },
      {
        "symbol": "CBA.AX",
        "companyName": "Commonwealth Bank"
      },
      {
        "symbol": "CHC.AX",
        "companyName": "Charter Hall Group"
      },
      {
        "symbol": "COH.AX",
        "companyName": "Cochlear Limited"
      },
      {
        "symbol": "COL.AX",
        "companyName": "Coles Group"
      },
      {
        "symbol": "CPU.AX",
        "companyName": "Computershare Limited"
      },
      {
        "symbol": "CSL.AX",
        "companyName": "CSL Limited"
      },
      {
        "symbol": "DXS.AX",
        "companyName": "Dexus"
      },
      {
        "symbol": "FMG.AX",
        "companyName": "Fortescue Metals Group"
      },
      {
        "symbol": "GMG.AX",
        "companyName": "Goodman Group"
      },
      {
        "symbol": "IAG.AX",
        "companyName": "Insurance Australia Group"
      },
      {
        "symbol": "IGO.AX",
        "companyName": "IGO Limited"
      },
      {
        "symbol": "JHX.AX",
        "companyName": "James Hardie Industries"
      },
      {
        "symbol": "MGR.AX",
        "companyName": "Mirvac Group"
      },
      {
        "symbol": "MIN.AX",
        "companyName": "Mineral Resources"
      },
      {
        "symbol": "MPL.AX",
        "companyName": "Medibank Private"
      },
      {
        "symbol": "MQG.AX",
        "companyName": "Macquarie Group"
      },
      {
        "symbol": "NAB.AX",
        "companyName": "National Australia Bank"
      },
      {
        "symbol": "NST.AX",
        "companyName": "Northern Star Resources"
      },
      {
        "symbol": "ORG.AX",
        "companyName": "Origin Energy"
      },
      {
        "symbol": "PLS.AX",
        "companyName": "Pilbara Minerals"
      },
      {
        "symbol": "QAN.AX",
        "companyName": "Qantas Airways"
      },
      {
        "symbol": "REA.AX",
        "companyName": "REA Group"
      },
      {
        "symbol": "REH.AX",
        "companyName": "Reece Limited"
      },
      {
        "symbol": "RIO.AX",
        "companyName": "Rio Tinto Limited"
      },
      {
        "symbol": "RMD.AX",
        "companyName": "ResMed Inc."
      },
      {
        "symbol": "S32.AX",
        "companyName": "South32 Limited"
      },
      {
        "symbol": "SCG.AX",
        "companyName": "Scentre Group"
      },
      {
        "symbol": "SEK.AX",
        "companyName": "SEEK Limited"
      },
      {
        "symbol": "SGP.AX",
        "companyName": "Stockland"
      },
      {
        "symbol": "SHL.AX",
        "companyName": "Sonic Healthcare"
      },
      {
        "symbol": "STO.AX",
        "companyName": "Santos Limited"
      },
      {
        "symbol": "SUN.AX",
        "companyName": "Suncorp Group"
      },
      {
        "symbol": "TCL.AX",
        "companyName": "Transurban Group"
      },
      {
        "symbol": "TLS.AX",
        "companyName": "Telstra Group"
      },
      {
        "symbol": "TWE.AX",
        "companyName": "Treasury Wine Estates"
      },
      {
        "symbol": "WBC.AX",
        "companyName": "Westpac Banking Corporation"
      },
      {
        "symbol": "WDS.AX",
        "companyName": "Woodside Energy Group"
      },
      {
        "symbol": "WES.AX",
        "companyName": "Wesfarmers Limited"
      },
      {
        "symbol": "WOW.AX",
        "companyName": "Woolworths Group"
      },
      {
        "symbol": "XRO.AX",
        "companyName": "Xero Limited"
      },
      {
        "symbol": "JBH.AX",
        "companyName": "JB Hi-Fi Limited"
      },
      {
        "symbol": "AZJ.AX",
        "companyName": "Aurizon Holdings Limited"
      },
      {
        "symbol": "SOL.AX",
        "companyName": "Washington H. Soul Pattinson and Company Limited"
      },
      {
        "symbol": "TLC.AX",
        "companyName": "The Lottery Corporation Limited"
      },
      {
        "symbol": "NEC.AX",
        "companyName": "Nine Entertainment Co. Holdings Limited"
      },
      {
        "symbol": "EVN.AX",
        "companyName": "Evolution Mining Limited"
      }
    ]
  },
  {
    "name": "Korea Exchange (KRX)",
    "stocks": [
      {
        "symbol": "005930.KS",
        "companyName": "Samsung Electronics"
      },
      {
        "symbol": "000660.KS",
        "companyName": "SK Hynix"
      },
      {
        "symbol": "005490.KS",
        "companyName": "POSCO Holdings"
      },
      {
        "symbol": "005380.KS",
        "companyName": "Hyundai Motor"
      },
      {
        "symbol": "000270.KS",
        "companyName": "Kia"
      },
      {
        "symbol": "051910.KS",
        "companyName": "LG Chem"
      },
      {
        "symbol": "035720.KS",
        "companyName": "Kakao"
      },
      {
        "symbol": "035420.KS",
        "companyName": "NAVER"
      },
      {
        "symbol": "105560.KS",
        "companyName": "KB Financial Group"
      },
      {
        "symbol": "068270.KS",
        "companyName": "Celltrion"
      },
      {
        "symbol": "005935.KS",
        "companyName": "Samsung Electronics Preferred"
      },
      {
        "symbol": "012450.KS",
        "companyName": "Hanwha Aerospace"
      },
      {
        "symbol": "259960.KS",
        "companyName": "Krafton"
      },
      {
        "symbol": "329180.KS",
        "companyName": "HD Korea Shipbuilding"
      },
      {
        "symbol": "207940.KS",
        "companyName": "Samsung Biologics"
      },
      {
        "symbol": "012330.KS",
        "companyName": "Hyundai Mobis"
      },
      {
        "symbol": "066570.KS",
        "companyName": "LG Electronics"
      },
      {
        "symbol": "017670.KS",
        "companyName": "SK Telecom"
      },
      {
        "symbol": "086790.KS",
        "companyName": "Hana Financial Group"
      },
      {
        "symbol": "000810.KS",
        "companyName": "Samsung Fire and Marine Insurance"
      },
      {
        "symbol": "042700.KS",
        "companyName": "Hanwha Systems Co., Ltd."
      },
      {
        "symbol": "028260.KS",
        "companyName": "Samsung C&T Corporation"
      },
      {
        "symbol": "030200.KS",
        "companyName": "KT Corporation"
      },
      {
        "symbol": "011200.KS",
        "companyName": "HMM Co., Ltd."
      },
      {
        "symbol": "096770.KS",
        "companyName": "SK Innovation Co., Ltd."
      },
      {
        "symbol": "055550.KS",
        "companyName": "Shinhan Financial Group"
      },
      {
        "symbol": "316140.KS",
        "companyName": "Woori Financial Group"
      },
      {
        "symbol": "373220.KS",
        "companyName": "LG Energy Solution"
      },
      {
        "symbol": "006400.KS",
        "companyName": "Samsung SDI"
      },
      {
        "symbol": "015760.KS",
        "companyName": "Korea Electric Power"
      },
      {
        "symbol": "032830.KS",
        "companyName": "Samsung Life Insurance"
      },
      {
        "symbol": "033780.KS",
        "companyName": "KT&G Corporation"
      },
      {
        "symbol": "034220.KS",
        "companyName": "LG Display"
      },
      {
        "symbol": "010950.KS",
        "companyName": "S-Oil"
      },
      {
        "symbol": "010130.KS",
        "companyName": "Korea Zinc"
      },
      {
        "symbol": "034020.KS",
        "companyName": "Doosan Enerbility"
      },
      {
        "symbol": "323410.KS",
        "companyName": "KakaoBank"
      },
      {
        "symbol": "377300.KS",
        "companyName": "KakaoPay"
      },
      {
        "symbol": "036570.KS",
        "companyName": "NCSoft"
      },
      {
        "symbol": "251270.KS",
        "companyName": "Netmarble"
      },
      {
        "symbol": "000720.KS",
        "companyName": "Hyundai Engineering and Construction"
      },
      {
        "symbol": "003670.KS",
        "companyName": "POSCO Future M"
      },
      {
        "symbol": "247540.KQ",
        "companyName": "Ecopro BM"
      },
      {
        "symbol": "047810.KS",
        "companyName": "Korea Aerospace Industries"
      },
      {
        "symbol": "079550.KS",
        "companyName": "LIG Nex1"
      }
    ]
  },
  {
    "name": "B3 Brazil Stock Exchange (B3/Bovespa)",
    "stocks": [
      {
        "symbol": "PETR4.SA",
        "companyName": "Petrobras"
      },
      {
        "symbol": "ITUB4.SA",
        "companyName": "Itau Unibanco"
      },
      {
        "symbol": "BBDC4.SA",
        "companyName": "Bradesco"
      },
      {
        "symbol": "B3SA3.SA",
        "companyName": "B3 Stock Exchange"
      },
      {
        "symbol": "ABEV3.SA",
        "companyName": "Ambev"
      },
      {
        "symbol": "WEGE3.SA",
        "companyName": "WEG"
      },
      {
        "symbol": "EMBR3.SA",
        "companyName": "Embraer"
      },
      {
        "symbol": "LREN3.SA",
        "companyName": "Lojas Renner"
      },
      {
        "symbol": "RENT3.SA",
        "companyName": "Localiza"
      },
      {
        "symbol": "RAIL3.SA",
        "companyName": "Rumo Logistica"
      },
      {
        "symbol": "SUZB3.SA",
        "companyName": "Suzano"
      },
      {
        "symbol": "JBSS3.SA",
        "companyName": "JBS"
      },
      {
        "symbol": "HAPV3.SA",
        "companyName": "Hapvida"
      },
      {
        "symbol": "MGLU3.SA",
        "companyName": "Magazine Luiza"
      },
      {
        "symbol": "RDOR3.SA",
        "companyName": "Rede D'Or"
      },
      {
        "symbol": "BBAS3.SA",
        "companyName": "Banco do Brasil S.A."
      },
      {
        "symbol": "ELET3.SA",
        "companyName": "Centrais Eletricas Brasileiras S.A."
      },
      {
        "symbol": "RADL3.SA",
        "companyName": "Raia Drogasil S.A."
      },
      {
        "symbol": "TOTS3.SA",
        "companyName": "Totvs S.A."
      },
      {
        "symbol": "CMIG4.SA",
        "companyName": "Companhia Energetica de Minas Gerais"
      },
      {
        "symbol": "ITSA4.SA",
        "companyName": "Itausa S.A."
      },
      {
        "symbol": "VIVT3.SA",
        "companyName": "Telefonica Brasil S.A."
      },
      {
        "symbol": "SANB11.SA",
        "companyName": "Banco Santander Brasil"
      },
      {
        "symbol": "GGBR4.SA",
        "companyName": "Gerdau"
      },
      {
        "symbol": "BPAC11.SA",
        "companyName": "BTG Pactual"
      },
      {
        "symbol": "KLBN11.SA",
        "companyName": "Klabin"
      },
      {
        "symbol": "MRFG3.SA",
        "companyName": "Marfrig Global Foods"
      },
      {
        "symbol": "NTCO3.SA",
        "companyName": "Natura and Co Holding"
      },
      {
        "symbol": "UGPA3.SA",
        "companyName": "Ultrapar Participacoes"
      },
      {
        "symbol": "VBBR3.SA",
        "companyName": "Vibra Energia"
      },
      {
        "symbol": "CSAN3.SA",
        "companyName": "Cosan"
      },
      {
        "symbol": "CCRO3.SA",
        "companyName": "CCR (Motiva)"
      },
      {
        "symbol": "SBSP3.SA",
        "companyName": "Companhia de Saneamento Basico do Estado de Sao Paulo"
      },
      {
        "symbol": "EGIE3.SA",
        "companyName": "Engie Brasil Energia"
      },
      {
        "symbol": "EQTL3.SA",
        "companyName": "Equatorial Energia"
      },
      {
        "symbol": "TIMS3.SA",
        "companyName": "TIM S.A."
      },
      {
        "symbol": "HYPE3.SA",
        "companyName": "Hypera"
      }
    ]
  },
  {
    "name": "Singapore Exchange (SGX)",
    "stocks": [
      {
        "symbol": "D05.SI",
        "companyName": "DBS Group"
      },
      {
        "symbol": "O39.SI",
        "companyName": "OCBC Bank"
      },
      {
        "symbol": "U11.SI",
        "companyName": "UOB"
      },
      {
        "symbol": "C6L.SI",
        "companyName": "Singapore Airlines"
      },
      {
        "symbol": "Z74.SI",
        "companyName": "Singtel"
      },
      {
        "symbol": "9CI.SI",
        "companyName": "CapitaLand Investment"
      },
      {
        "symbol": "J36.SI",
        "companyName": "Jardine Matheson"
      },
      {
        "symbol": "F34.SI",
        "companyName": "Wilmar International"
      },
      {
        "symbol": "S68.SI",
        "companyName": "Singapore Exchange Limited"
      },
      {
        "symbol": "G13.SI",
        "companyName": "Genting Singapore Limited"
      },
      {
        "symbol": "S58.SI",
        "companyName": "SATS Ltd."
      },
      {
        "symbol": "BN4.SI",
        "companyName": "Keppel Ltd."
      },
      {
        "symbol": "U96.SI",
        "companyName": "Sembcorp Industries Ltd."
      },
      {
        "symbol": "S63.SI",
        "companyName": "ST Engineering"
      },
      {
        "symbol": "C38U.SI",
        "companyName": "CapitaLand Integrated Commercial Trust"
      },
      {
        "symbol": "A17U.SI",
        "companyName": "CapitaLand Ascendas REIT"
      },
      {
        "symbol": "M44U.SI",
        "companyName": "Mapletree Logistics Trust"
      },
      {
        "symbol": "Y92.SI",
        "companyName": "Thai Beverage"
      },
      {
        "symbol": "G07.SI",
        "companyName": "Great Eastern Holdings"
      },
      {
        "symbol": "C09.SI",
        "companyName": "City Developments"
      },
      {
        "symbol": "U14.SI",
        "companyName": "UOL Group"
      },
      {
        "symbol": "H78.SI",
        "companyName": "Hongkong Land Holdings"
      },
      {
        "symbol": "D01.SI",
        "companyName": "DFI Retail Group"
      },
      {
        "symbol": "5E2.SI",
        "companyName": "Seatrium"
      },
      {
        "symbol": "BS6.SI",
        "companyName": "Yangzijiang Shipbuilding"
      }
    ]
  },
  {
    "name": "Taiwan Stock Exchange (TWSE)",
    "stocks": [
      {
        "symbol": "2330.TW",
        "companyName": "TSMC"
      },
      {
        "symbol": "2317.TW",
        "companyName": "Foxconn"
      },
      {
        "symbol": "2454.TW",
        "companyName": "MediaTek"
      },
      {
        "symbol": "2382.TW",
        "companyName": "Quanta Computer"
      },
      {
        "symbol": "2412.TW",
        "companyName": "Chunghwa Telecom"
      },
      {
        "symbol": "2308.TW",
        "companyName": "Delta Electronics"
      },
      {
        "symbol": "2881.TW",
        "companyName": "Fubon Financial"
      },
      {
        "symbol": "2002.TW",
        "companyName": "China Steel"
      },
      {
        "symbol": "2303.TW",
        "companyName": "United Microelectronics Corporation"
      },
      {
        "symbol": "2357.TW",
        "companyName": "ASUSTeK Computer Inc."
      },
      {
        "symbol": "3711.TW",
        "companyName": "ASE Technology Holding Co., Ltd."
      },
      {
        "symbol": "2379.TW",
        "companyName": "Realtek Semiconductor Corp."
      },
      {
        "symbol": "2886.TW",
        "companyName": "Mega Financial Holding Co., Ltd."
      },
      {
        "symbol": "2882.TW",
        "companyName": "Cathay Financial Holding"
      },
      {
        "symbol": "2891.TW",
        "companyName": "CTBC Financial Holding"
      },
      {
        "symbol": "2884.TW",
        "companyName": "E.Sun Financial Holding"
      },
      {
        "symbol": "2880.TW",
        "companyName": "Hua Nan Financial Holding"
      },
      {
        "symbol": "1301.TW",
        "companyName": "Formosa Plastics"
      },
      {
        "symbol": "1303.TW",
        "companyName": "Nan Ya Plastics"
      },
      {
        "symbol": "1326.TW",
        "companyName": "Formosa Chemicals and Fibre"
      },
      {
        "symbol": "6505.TW",
        "companyName": "Formosa Petrochemical"
      },
      {
        "symbol": "2207.TW",
        "companyName": "Hotai Motor"
      },
      {
        "symbol": "2912.TW",
        "companyName": "President Chain Store"
      },
      {
        "symbol": "3008.TW",
        "companyName": "Largan Precision"
      },
      {
        "symbol": "2603.TW",
        "companyName": "Evergreen Marine"
      },
      {
        "symbol": "2609.TW",
        "companyName": "Yang Ming Marine Transport"
      },
      {
        "symbol": "2615.TW",
        "companyName": "Wan Hai Lines"
      }
    ]
  },
  {
    "name": "Mexican Stock Exchange (BMV)",
    "stocks": [
      {
        "symbol": "AMXL.MX",
        "companyName": "America Movil"
      },
      {
        "symbol": "CEMEXCPO.MX",
        "companyName": "Cemex"
      },
      {
        "symbol": "FEMSAUBD.MX",
        "companyName": "FEMSA"
      },
      {
        "symbol": "BIMBOA.MX",
        "companyName": "Grupo Bimbo"
      },
      {
        "symbol": "GFNORTEO.MX",
        "companyName": "Banorte"
      },
      {
        "symbol": "WALMEX.MX",
        "companyName": "Walmart Mexico"
      },
      {
        "symbol": "TLEVISACPO.MX",
        "companyName": "Televisa"
      },
      {
        "symbol": "ASURB.MX",
        "companyName": "Aeroportuario del Pacifico"
      },
      {
        "symbol": "GMEXICOB.MX",
        "companyName": "Grupo Mexico"
      },
      {
        "symbol": "VOLAR.MX",
        "companyName": "Volaris"
      },
      {
        "symbol": "ALSEA.MX",
        "companyName": "Alsea, S.A.B. de C.V."
      },
      {
        "symbol": "GRUMAB.MX",
        "companyName": "Gruma, S.A.B. de C.V."
      },
      {
        "symbol": "VESTA.MX",
        "companyName": "Corporacion Inmobiliaria Vesta, S.A.B. de C.V."
      },
      {
        "symbol": "AC.MX",
        "companyName": "Arca Continental"
      },
      {
        "symbol": "GFINBURO.MX",
        "companyName": "Grupo Financiero Inbursa"
      },
      {
        "symbol": "GAPB.MX",
        "companyName": "Grupo Aeroportuario del Pacifico"
      },
      {
        "symbol": "OMAB.MX",
        "companyName": "Grupo Aeroportuario Centro Norte"
      },
      {
        "symbol": "KIMBERA.MX",
        "companyName": "Kimberly-Clark de Mexico"
      },
      {
        "symbol": "PINFRA.MX",
        "companyName": "Promotora y Operadora de Infraestructura"
      },
      {
        "symbol": "MEGACPO.MX",
        "companyName": "Megacable Holdings"
      },
      {
        "symbol": "LABB.MX",
        "companyName": "Genomma Lab Internacional"
      },
      {
        "symbol": "Q.MX",
        "companyName": "Qualitas Controladora"
      }
    ]
  },
  {
    "name": "Saudi Stock Exchange (Tadawul)",
    "stocks": [
      {
        "symbol": "2222.SR",
        "companyName": "Saudi Aramco"
      },
      {
        "symbol": "1120.SR",
        "companyName": "Al Rajhi Bank"
      },
      {
        "symbol": "7010.SR",
        "companyName": "Saudi Telecom STC"
      },
      {
        "symbol": "2010.SR",
        "companyName": "Sabic"
      },
      {
        "symbol": "1180.SR",
        "companyName": "Saudi National Bank"
      },
      {
        "symbol": "1010.SR",
        "companyName": "Riyad Bank"
      },
      {
        "symbol": "1211.SR",
        "companyName": "Maaden"
      },
      {
        "symbol": "1150.SR",
        "companyName": "Saudi Industrial Investment Group"
      },
      {
        "symbol": "4030.SR",
        "companyName": "Bahri (National Shipping Company of Saudi Arabia)"
      },
      {
        "symbol": "2280.SR",
        "companyName": "Almarai"
      },
      {
        "symbol": "2082.SR",
        "companyName": "ACWA Power"
      },
      {
        "symbol": "4190.SR",
        "companyName": "Jarir Marketing"
      },
      {
        "symbol": "2020.SR",
        "companyName": "SABIC Agri-Nutrients"
      },
      {
        "symbol": "1140.SR",
        "companyName": "Bank Albilad"
      },
      {
        "symbol": "4013.SR",
        "companyName": "Dr. Sulaiman Al Habib Medical Services"
      }
    ]
  },
  {
    "name": "Nordic Exchanges (Nasdaq Nordic)",
    "stocks": [
      {
        "symbol": "ERIC-B.ST",
        "companyName": "Telefonaktiebolaget LM Ericsson"
      },
      {
        "symbol": "SWED-A.ST",
        "companyName": "Swedbank AB"
      },
      {
        "symbol": "SHB-A.ST",
        "companyName": "Svenska Handelsbanken AB"
      },
      {
        "symbol": "INVE-B.ST",
        "companyName": "Investor AB"
      },
      {
        "symbol": "ATCO-A.ST",
        "companyName": "Atlas Copco AB"
      },
      {
        "symbol": "TEL2-B.ST",
        "companyName": "Tele2 AB"
      },
      {
        "symbol": "VOLV-B.ST",
        "companyName": "Volvo AB"
      },
      {
        "symbol": "SKF-B.ST",
        "companyName": "SKF AB"
      },
      {
        "symbol": "SSAB-A.ST",
        "companyName": "SSAB AB"
      },
      {
        "symbol": "NDA-SE.ST",
        "companyName": "Nordea Bank Abp"
      },
      {
        "symbol": "NESTE.HE",
        "companyName": "Neste Oyj"
      },
      {
        "symbol": "FORTUM.HE",
        "companyName": "Fortum Oyj"
      },
      {
        "symbol": "UPM.HE",
        "companyName": "UPM-Kymmene Oyj"
      },
      {
        "symbol": "NOKIA.HE",
        "companyName": "Nokia Oyj"
      },
      {
        "symbol": "METSB.HE",
        "companyName": "Metsa Board Oyj"
      },
      {
        "symbol": "ORK.OL",
        "companyName": "Orkla ASA"
      },
      {
        "symbol": "DNB.OL",
        "companyName": "DNB Bank ASA"
      },
      {
        "symbol": "MOWI.OL",
        "companyName": "Mowi ASA"
      },
      {
        "symbol": "YAR.OL",
        "companyName": "Yara International ASA"
      },
      {
        "symbol": "AKRBP.OL",
        "companyName": "Aker BP ASA"
      },
      {
        "symbol": "ORSTED.CO",
        "companyName": "Orsted A/S"
      },
      {
        "symbol": "COLO-B.CO",
        "companyName": "Coloplast A/S"
      },
      {
        "symbol": "CARL-B.CO",
        "companyName": "Carlsberg A/S"
      },
      {
        "symbol": "GMAB.CO",
        "companyName": "Genmab A/S"
      },
      {
        "symbol": "ASSA-B.ST",
        "companyName": "Assa Abloy AB"
      },
      {
        "symbol": "SAND.ST",
        "companyName": "Sandvik AB"
      },
      {
        "symbol": "EVO.ST",
        "companyName": "Evolution AB"
      },
      {
        "symbol": "SAAB-B.ST",
        "companyName": "Saab AB"
      },
      {
        "symbol": "NIBE-B.ST",
        "companyName": "NIBE Industrier AB"
      },
      {
        "symbol": "SUBC.OL",
        "companyName": "Subsea 7 S.A."
      },
      {
        "symbol": "NEL.OL",
        "companyName": "Nel ASA"
      },
      {
        "symbol": "SALM.OL",
        "companyName": "SalMar ASA"
      },
      {
        "symbol": "DEMANT.CO",
        "companyName": "Demant A/S"
      },
      {
        "symbol": "GN.CO",
        "companyName": "GN Store Nord A/S"
      },
      {
        "symbol": "KNEBV.HE",
        "companyName": "KONE Oyj"
      },
      {
        "symbol": "WRT1V.HE",
        "companyName": "Wartsila Oyj Abp"
      }
    ]
  },
  {
    "name": "Johannesburg Stock Exchange (JSE)",
    "stocks": [
      {
        "symbol": "NPN.JO",
        "companyName": "Naspers Limited"
      },
      {
        "symbol": "SOL.JO",
        "companyName": "Sasol Limited"
      },
      {
        "symbol": "ABG.JO",
        "companyName": "Absa Group Limited"
      },
      {
        "symbol": "SBK.JO",
        "companyName": "Standard Bank Group"
      },
      {
        "symbol": "FSR.JO",
        "companyName": "FirstRand Limited"
      },
      {
        "symbol": "NED.JO",
        "companyName": "Nedbank Group"
      },
      {
        "symbol": "AGL.JO",
        "companyName": "Anglo American plc"
      },
      {
        "symbol": "BHP.JO",
        "companyName": "BHP Group Limited"
      },
      {
        "symbol": "MTN.JO",
        "companyName": "MTN Group"
      },
      {
        "symbol": "VOD.JO",
        "companyName": "Vodacom Group"
      },
      {
        "symbol": "CPI.JO",
        "companyName": "Capitec Bank Holdings"
      },
      {
        "symbol": "SHP.JO",
        "companyName": "Shoprite Holdings"
      },
      {
        "symbol": "WHL.JO",
        "companyName": "Woolworths Holdings"
      },
      {
        "symbol": "CLS.JO",
        "companyName": "Clicks Group"
      },
      {
        "symbol": "BVT.JO",
        "companyName": "Bidvest Group"
      },
      {
        "symbol": "BID.JO",
        "companyName": "Bid Corporation"
      },
      {
        "symbol": "SLM.JO",
        "companyName": "Sanlam"
      },
      {
        "symbol": "OMU.JO",
        "companyName": "Old Mutual"
      },
      {
        "symbol": "DSY.JO",
        "companyName": "Discovery Limited"
      },
      {
        "symbol": "GFI.JO",
        "companyName": "Gold Fields"
      },
      {
        "symbol": "ANG.JO",
        "companyName": "AngloGold Ashanti"
      }
    ]
  },
  {
    "name": "Israeli Tech (Nasdaq-listed)",
    "stocks": [
      {
        "symbol": "ESLT",
        "companyName": "Elbit Systems Ltd."
      },
      {
        "symbol": "NICE",
        "companyName": "NICE Ltd."
      },
      {
        "symbol": "CHKP",
        "companyName": "Check Point Software Technologies"
      },
      {
        "symbol": "AMDOCS",
        "companyName": "Amdocs Limited"
      },
      {
        "symbol": "GILT",
        "companyName": "Gilat Satellite Networks"
      },
      {
        "symbol": "CYBR",
        "companyName": "CyberArk Software"
      },
      {
        "symbol": "S",
        "companyName": "SentinelOne"
      },
      {
        "symbol": "WIX",
        "companyName": "Wix.com"
      },
      {
        "symbol": "MNDY",
        "companyName": "monday.com"
      },
      {
        "symbol": "GLBE",
        "companyName": "Global-e Online"
      },
      {
        "symbol": "TEVA",
        "companyName": "Teva Pharmaceutical Industries"
      },
      {
        "symbol": "MBLY",
        "companyName": "Mobileye Global"
      },
      {
        "symbol": "NVMI",
        "companyName": "Nova Ltd"
      },
      {
        "symbol": "TSEM",
        "companyName": "Tower Semiconductor"
      },
      {
        "symbol": "PLTK",
        "companyName": "Playtika Holding"
      },
      {
        "symbol": "ODD",
        "companyName": "Oddity Tech"
      },
      {
        "symbol": "FVRR",
        "companyName": "Fiverr International"
      }
    ]
  },
  {
    "name": "Southeast Asia (Additional)",
    "stocks": [
      {
        "symbol": "GRAB",
        "companyName": "Grab Holdings Limited"
      },
      {
        "symbol": "SEA",
        "companyName": "Sea Limited"
      },
      {
        "symbol": "GOTO.JK",
        "companyName": "GoTo Gojek Tokopedia Tbk"
      },
      {
        "symbol": "BBRI.JK",
        "companyName": "Bank Rakyat Indonesia"
      },
      {
        "symbol": "BMRI.JK",
        "companyName": "Bank Mandiri"
      },
      {
        "symbol": "TLKM.JK",
        "companyName": "Telkom Indonesia"
      },
      {
        "symbol": "ASII.JK",
        "companyName": "Astra International"
      },
      {
        "symbol": "BBCA.JK",
        "companyName": "Bank Central Asia"
      },
      {
        "symbol": "BBNI.JK",
        "companyName": "Bank Negara Indonesia"
      },
      {
        "symbol": "TPIA.JK",
        "companyName": "Chandra Asri Pacific"
      },
      {
        "symbol": "BREN.JK",
        "companyName": "Barito Renewables Energy"
      },
      {
        "symbol": "UNVR.JK",
        "companyName": "Unilever Indonesia"
      },
      {
        "symbol": "ICBP.JK",
        "companyName": "Indofood CBP Sukses Makmur"
      },
      {
        "symbol": "INDF.JK",
        "companyName": "Indofood Sukses Makmur"
      },
      {
        "symbol": "PGAS.JK",
        "companyName": "Perusahaan Gas Negara"
      },
      {
        "symbol": "ANTM.JK",
        "companyName": "Aneka Tambang"
      },
      {
        "symbol": "HMSP.JK",
        "companyName": "HM Sampoerna"
      }
    ]
  },
  {
    "name": "Vietnam Stock Exchange (HoSE)",
    "stocks": [
      {
        "symbol": "VCB.VN",
        "companyName": "Joint Stock Commercial Bank for Foreign Trade of Vietnam"
      },
      {
        "symbol": "VIC.VN",
        "companyName": "Vingroup Joint Stock Company"
      },
      {
        "symbol": "VHM.VN",
        "companyName": "Vinhomes Joint Stock Company"
      },
      {
        "symbol": "VNM.VN",
        "companyName": "Vietnam Dairy Products Joint Stock Company"
      },
      {
        "symbol": "HPG.VN",
        "companyName": "Hoa Phat Group Joint Stock Company"
      },
      {
        "symbol": "MSN.VN",
        "companyName": "Masan Group Corporation"
      },
      {
        "symbol": "TCB.VN",
        "companyName": "Vietnam Technological and Commercial Joint Stock Bank"
      },
      {
        "symbol": "VPB.VN",
        "companyName": "Vietnam Prosperity Joint Stock Commercial Bank"
      },
      {
        "symbol": "FPT.VN",
        "companyName": "FPT Corporation"
      },
      {
        "symbol": "MWG.VN",
        "companyName": "Mobile World Investment"
      },
      {
        "symbol": "GAS.VN",
        "companyName": "PetroVietnam Gas"
      },
      {
        "symbol": "VRE.VN",
        "companyName": "Vincom Retail"
      },
      {
        "symbol": "CTG.VN",
        "companyName": "VietinBank"
      },
      {
        "symbol": "MBB.VN",
        "companyName": "Military Commercial Bank"
      },
      {
        "symbol": "VJC.VN",
        "companyName": "Vietjet Aviation"
      },
      {
        "symbol": "SAB.VN",
        "companyName": "Saigon Beer-Alcohol-Beverage (Sabeco)"
      },
      {
        "symbol": "PLX.VN",
        "companyName": "Petrolimex"
      },
      {
        "symbol": "SSI.VN",
        "companyName": "SSI Securities"
      },
      {
        "symbol": "PNJ.VN",
        "companyName": "Phu Nhuan Jewelry"
      }
    ]
  },
  {
    "name": "Borsa Istanbul (BIST)",
    "stocks": [
      {
        "symbol": "THYAO.IS",
        "companyName": "Turk Hava Yollari A.O. (Turkish Airlines)"
      },
      {
        "symbol": "KCHOL.IS",
        "companyName": "Koc Holding A.S."
      },
      {
        "symbol": "EREGL.IS",
        "companyName": "Eregli Demir ve Celik Fabrikalari T.A.S."
      },
      {
        "symbol": "AKBNK.IS",
        "companyName": "Akbank T.A.S."
      },
      {
        "symbol": "GARAN.IS",
        "companyName": "Turkiye Garanti Bankasi A.S."
      },
      {
        "symbol": "BIMAS.IS",
        "companyName": "BIM Birlesik Magazalar A.S."
      },
      {
        "symbol": "SISE.IS",
        "companyName": "Turkiye Sise ve Cam Fabrikalari A.S."
      },
      {
        "symbol": "TKFEN.IS",
        "companyName": "Tekfen Holding A.S."
      },
      {
        "symbol": "ASELS.IS",
        "companyName": "Aselsan"
      },
      {
        "symbol": "FROTO.IS",
        "companyName": "Ford Otosan"
      },
      {
        "symbol": "TUPRS.IS",
        "companyName": "Turkiye Petrol Rafinerileri"
      },
      {
        "symbol": "SAHOL.IS",
        "companyName": "Haci Omer Sabanci Holding"
      },
      {
        "symbol": "ISCTR.IS",
        "companyName": "Turkiye Is Bankasi"
      },
      {
        "symbol": "YKBNK.IS",
        "companyName": "Yapi ve Kredi Bankasi"
      },
      {
        "symbol": "VAKBN.IS",
        "companyName": "Turkiye Vakiflar Bankasi"
      },
      {
        "symbol": "TCELL.IS",
        "companyName": "Turkcell Iletisim Hizmetleri"
      },
      {
        "symbol": "ENKAI.IS",
        "companyName": "Enka Insaat ve Sanayi"
      },
      {
        "symbol": "SASA.IS",
        "companyName": "Sasa Polyester Sanayi"
      },
      {
        "symbol": "ASTOR.IS",
        "companyName": "Astor Enerji"
      }
    ]
  },
  {
    "name": "UAE Exchanges (ADX & DFM)",
    "stocks": [
      {
        "symbol": "FAB.AB",
        "companyName": "First Abu Dhabi Bank PJSC"
      },
      {
        "symbol": "EMAAR.AE",
        "companyName": "Emaar Properties PJSC"
      },
      {
        "symbol": "DIB.AE",
        "companyName": "Dubai Islamic Bank PJSC"
      },
      {
        "symbol": "EMIRATESNBD.AE",
        "companyName": "Emirates NBD Bank PJSC"
      },
      {
        "symbol": "ALDAR.AB",
        "companyName": "Aldar Properties PJSC"
      },
      {
        "symbol": "IHC.AB",
        "companyName": "International Holding Company"
      },
      {
        "symbol": "ADNOCGAS.AB",
        "companyName": "ADNOC Gas"
      },
      {
        "symbol": "ADNOCDRILL.AB",
        "companyName": "ADNOC Drilling"
      },
      {
        "symbol": "ETISALAT.AB",
        "companyName": "e& (Etisalat Group)"
      },
      {
        "symbol": "TAQA.AB",
        "companyName": "Abu Dhabi National Energy"
      },
      {
        "symbol": "ADIB.AB",
        "companyName": "Abu Dhabi Islamic Bank"
      },
      {
        "symbol": "ADCB.AB",
        "companyName": "Abu Dhabi Commercial Bank"
      },
      {
        "symbol": "BOROUGE.AB",
        "companyName": "Borouge"
      },
      {
        "symbol": "AMR.AB",
        "companyName": "Americana Restaurants International"
      },
      {
        "symbol": "DEWA.AE",
        "companyName": "Dubai Electricity and Water Authority"
      },
      {
        "symbol": "SALIK.AE",
        "companyName": "Salik Company"
      },
      {
        "symbol": "TALABAT.AE",
        "companyName": "Talabat Holding"
      },
      {
        "symbol": "AIRARABIA.AE",
        "companyName": "Air Arabia"
      },
      {
        "symbol": "PARKIN.AE",
        "companyName": "Parkin Company"
      }
    ]
  },
  {
    "name": "Bursa Malaysia",
    "stocks": [
      {
        "symbol": "1155.KL",
        "companyName": "Malayan Banking Berhad"
      },
      {
        "symbol": "5347.KL",
        "companyName": "Tenaga Nasional Berhad"
      },
      {
        "symbol": "1295.KL",
        "companyName": "Public Bank Berhad"
      },
      {
        "symbol": "1023.KL",
        "companyName": "CIMB Group Holdings Berhad"
      },
      {
        "symbol": "6012.KL",
        "companyName": "Maxis Berhad"
      },
      {
        "symbol": "4197.KL",
        "companyName": "Sime Darby Berhad"
      },
      {
        "symbol": "1961.KL",
        "companyName": "IOI Corporation Berhad"
      },
      {
        "symbol": "5183.KL",
        "companyName": "Petronas Chemicals Group"
      },
      {
        "symbol": "5681.KL",
        "companyName": "Petronas Dagangan"
      },
      {
        "symbol": "6033.KL",
        "companyName": "Petronas Gas"
      },
      {
        "symbol": "5225.KL",
        "companyName": "IHH Healthcare"
      },
      {
        "symbol": "3816.KL",
        "companyName": "MISC Berhad"
      },
      {
        "symbol": "6888.KL",
        "companyName": "Axiata Group"
      },
      {
        "symbol": "1066.KL",
        "companyName": "RHB Bank"
      },
      {
        "symbol": "5819.KL",
        "companyName": "Hong Leong Bank"
      },
      {
        "symbol": "1082.KL",
        "companyName": "Hong Leong Financial Group"
      },
      {
        "symbol": "3182.KL",
        "companyName": "Genting Berhad"
      },
      {
        "symbol": "4715.KL",
        "companyName": "Genting Malaysia"
      }
    ]
  },
  {
    "name": "Stock Exchange of Thailand (SET)",
    "stocks": [
      {
        "symbol": "PTT.BK",
        "companyName": "PTT Public Company Limited"
      },
      {
        "symbol": "KBANK.BK",
        "companyName": "Kasikornbank Public Company Limited"
      },
      {
        "symbol": "SCB.BK",
        "companyName": "SCB X Public Company Limited"
      },
      {
        "symbol": "ADVANC.BK",
        "companyName": "Advanced Info Service Public Company Limited"
      },
      {
        "symbol": "AOT.BK",
        "companyName": "Airports of Thailand Public Company Limited"
      },
      {
        "symbol": "CPALL.BK",
        "companyName": "CP All Public Company Limited"
      },
      {
        "symbol": "GULF.BK",
        "companyName": "Gulf Energy Development Public Company Limited"
      },
      {
        "symbol": "MINT.BK",
        "companyName": "Minor International Public Company Limited"
      },
      {
        "symbol": "PTTEP.BK",
        "companyName": "PTT Exploration and Production"
      },
      {
        "symbol": "OR.BK",
        "companyName": "PTT Oil and Retail Business"
      },
      {
        "symbol": "SCC.BK",
        "companyName": "Siam Cement"
      },
      {
        "symbol": "BDMS.BK",
        "companyName": "Bangkok Dusit Medical Services"
      },
      {
        "symbol": "BH.BK",
        "companyName": "Bumrungrad Hospital"
      },
      {
        "symbol": "CPAXT.BK",
        "companyName": "CP Axtra"
      },
      {
        "symbol": "CPF.BK",
        "companyName": "Charoen Pokphand Foods"
      },
      {
        "symbol": "CPN.BK",
        "companyName": "Central Pattana"
      },
      {
        "symbol": "KTB.BK",
        "companyName": "Krung Thai Bank"
      },
      {
        "symbol": "TTB.BK",
        "companyName": "TMBThanachart Bank"
      },
      {
        "symbol": "TRUE.BK",
        "companyName": "True Corporation"
      },
      {
        "symbol": "HMPRO.BK",
        "companyName": "Home Product Center"
      },
      {
        "symbol": "DELTA.BK",
        "companyName": "Delta Electronics Thailand"
      }
    ]
  },
  {
    "name": "Warsaw Stock Exchange (GPW)",
    "stocks": [
      {
        "symbol": "CDR.WA",
        "companyName": "CD Projekt S.A."
      },
      {
        "symbol": "PKN.WA",
        "companyName": "Polski Koncern Naftowy ORLEN S.A."
      },
      {
        "symbol": "PKO.WA",
        "companyName": "Powszechna Kasa Oszczednosci Bank Polski S.A."
      },
      {
        "symbol": "PZU.WA",
        "companyName": "Powszechny Zaklad Ubezpieczen S.A."
      },
      {
        "symbol": "LPP.WA",
        "companyName": "LPP S.A."
      },
      {
        "symbol": "KGHM.WA",
        "companyName": "KGHM Polska Miedz S.A."
      },
      {
        "symbol": "PGE.WA",
        "companyName": "Polska Grupa Energetyczna S.A."
      },
      {
        "symbol": "CPS.WA",
        "companyName": "Cyfrowy Polsat S.A."
      },
      {
        "symbol": "ALE.WA",
        "companyName": "Allegro.eu"
      },
      {
        "symbol": "DNP.WA",
        "companyName": "Dino Polska"
      },
      {
        "symbol": "PEO.WA",
        "companyName": "Bank Pekao"
      },
      {
        "symbol": "SPL.WA",
        "companyName": "Erste Bank Polska"
      },
      {
        "symbol": "MBK.WA",
        "companyName": "mBank"
      },
      {
        "symbol": "OPL.WA",
        "companyName": "Orange Polska"
      },
      {
        "symbol": "PCO.WA",
        "companyName": "Pepco Group"
      },
      {
        "symbol": "CCC.WA",
        "companyName": "CCC S.A."
      },
      {
        "symbol": "BDX.WA",
        "companyName": "Budimex"
      }
    ]
  },
  {
    "name": "Philippine Stock Exchange (PSE)",
    "stocks": [
      {
        "symbol": "SM.PS",
        "companyName": "SM Investments Corporation"
      },
      {
        "symbol": "BDO.PS",
        "companyName": "BDO Unibank"
      },
      {
        "symbol": "ICT.PS",
        "companyName": "International Container Terminal Services"
      },
      {
        "symbol": "SMPH.PS",
        "companyName": "SM Prime Holdings"
      },
      {
        "symbol": "BPI.PS",
        "companyName": "Bank of the Philippine Islands"
      },
      {
        "symbol": "AC.PS",
        "companyName": "Ayala Corporation"
      },
      {
        "symbol": "ALI.PS",
        "companyName": "Ayala Land"
      },
      {
        "symbol": "JFC.PS",
        "companyName": "Jollibee Foods Corporation"
      },
      {
        "symbol": "GLO.PS",
        "companyName": "Globe Telecom"
      },
      {
        "symbol": "MER.PS",
        "companyName": "Manila Electric Company"
      },
      {
        "symbol": "TEL.PS",
        "companyName": "PLDT Inc."
      }
    ]
  },
  {
    "name": "Santiago Stock Exchange (Chile)",
    "stocks": [
      {
        "symbol": "FALABELLA.SN",
        "companyName": "Falabella"
      },
      {
        "symbol": "COPEC.SN",
        "companyName": "Empresas Copec"
      },
      {
        "symbol": "ENELCHILE.SN",
        "companyName": "Enel Chile"
      },
      {
        "symbol": "CENCOSUD.SN",
        "companyName": "Cencosud"
      },
      {
        "symbol": "CCU.SN",
        "companyName": "Compania Cervecerias Unidas"
      },
      {
        "symbol": "CHILE.SN",
        "companyName": "Banco de Chile"
      },
      {
        "symbol": "BSANTANDER.SN",
        "companyName": "Banco Santander-Chile"
      },
      {
        "symbol": "LTM.SN",
        "companyName": "LATAM Airlines Group"
      },
      {
        "symbol": "CMPC.SN",
        "companyName": "Empresas CMPC"
      },
      {
        "symbol": "COLBUN.SN",
        "companyName": "Colbun"
      },
      {
        "symbol": "AGUAS-A.SN",
        "companyName": "Aguas Andinas"
      },
      {
        "symbol": "PARAUCO.SN",
        "companyName": "Parque Arauco"
      },
      {
        "symbol": "SQM-B.SN",
        "companyName": "Sociedad Quimica y Minera (B shares)"
      }
    ]
  },
  {
    "name": "Bolsa de Valores de Colombia (BVC)",
    "stocks": [
      {
        "symbol": "ECOPETROL.CL",
        "companyName": "Ecopetrol"
      },
      {
        "symbol": "PFBCOLOM.CL",
        "companyName": "Bancolombia (preferred)"
      },
      {
        "symbol": "GRUPOSURA.CL",
        "companyName": "Grupo SURA"
      },
      {
        "symbol": "GRUPOARGOS.CL",
        "companyName": "Grupo Argos"
      },
      {
        "symbol": "CEMARGOS.CL",
        "companyName": "Cementos Argos"
      },
      {
        "symbol": "GEB.CL",
        "companyName": "Grupo Energia Bogota"
      },
      {
        "symbol": "ISA.CL",
        "companyName": "Interconexion Electrica (ISA)"
      },
      {
        "symbol": "NUTRESA.CL",
        "companyName": "Grupo Nutresa"
      },
      {
        "symbol": "CELSIA.CL",
        "companyName": "Celsia"
      },
      {
        "symbol": "PFAVAL.CL",
        "companyName": "Grupo Aval (preferred)"
      }
    ]
  },
  {
    "name": "Bolsa de Valores de Lima (Peru)",
    "stocks": [
      {
        "symbol": "IFS.LM",
        "companyName": "Intercorp Financial Services"
      },
      {
        "symbol": "BVN.LM",
        "companyName": "Compania de Minas Buenaventura"
      },
      {
        "symbol": "ALICORC1.LM",
        "companyName": "Alicorp"
      },
      {
        "symbol": "FERREYC1.LM",
        "companyName": "Ferreycorp"
      },
      {
        "symbol": "CPACASI1.LM",
        "companyName": "Cementos Pacasmayo (investment shares)"
      },
      {
        "symbol": "MINSURI1.LM",
        "companyName": "Minsur (investment shares)"
      },
      {
        "symbol": "INRETC1.LM",
        "companyName": "InRetail Peru"
      },
      {
        "symbol": "VOLCABC1.LM",
        "companyName": "Volcan Compania Minera (B)"
      },
      {
        "symbol": "BAP",
        "companyName": "Credicorp (NYSE ADR; no confirmed Lima line)"
      }
    ]
  },
  {
    "name": "Argentina (BYMA / US ADRs)",
    "stocks": [
      {
        "symbol": "GGAL",
        "companyName": "Grupo Financiero Galicia (ADR)"
      },
      {
        "symbol": "YPF",
        "companyName": "YPF S.A. (ADR)"
      },
      {
        "symbol": "BMA",
        "companyName": "Banco Macro (ADR)"
      },
      {
        "symbol": "PAM",
        "companyName": "Pampa Energia (ADR)"
      },
      {
        "symbol": "BBAR",
        "companyName": "Banco BBVA Argentina (ADR)"
      },
      {
        "symbol": "SUPV",
        "companyName": "Grupo Supervielle (ADR)"
      },
      {
        "symbol": "LOMA",
        "companyName": "Loma Negra (ADR)"
      },
      {
        "symbol": "CRESY",
        "companyName": "Cresud (ADR)"
      },
      {
        "symbol": "TEO",
        "companyName": "Telecom Argentina (ADR)"
      },
      {
        "symbol": "CEPU",
        "companyName": "Central Puerto (ADR)"
      },
      {
        "symbol": "BYMA.BA",
        "companyName": "Bolsas y Mercados Argentinos"
      }
    ]
  },
  {
    "name": "Qatar Exchange",
    "stocks": [
      {
        "symbol": "QNBK.QA",
        "companyName": "Qatar National Bank"
      },
      {
        "symbol": "IQCD.QA",
        "companyName": "Industries Qatar"
      },
      {
        "symbol": "QIBK.QA",
        "companyName": "Qatar Islamic Bank"
      },
      {
        "symbol": "QGTS.QA",
        "companyName": "Qatar Gas Transport (Nakilat)"
      },
      {
        "symbol": "QFLS.QA",
        "companyName": "Qatar Fuel (WOQOD)"
      },
      {
        "symbol": "QEWS.QA",
        "companyName": "Qatar Electricity and Water"
      },
      {
        "symbol": "MARK.QA",
        "companyName": "Masraf Al Rayan"
      },
      {
        "symbol": "QATI.QA",
        "companyName": "Qatar Insurance"
      }
    ]
  },
  {
    "name": "Boursa Kuwait",
    "stocks": [
      {
        "symbol": "NBK.KW",
        "companyName": "National Bank of Kuwait"
      },
      {
        "symbol": "KFH.KW",
        "companyName": "Kuwait Finance House"
      },
      {
        "symbol": "ZAIN.KW",
        "companyName": "Mobile Telecommunications (Zain)"
      },
      {
        "symbol": "BOUBYAN.KW",
        "companyName": "Boubyan Bank"
      },
      {
        "symbol": "AGLTY.KW",
        "companyName": "Agility Public Warehousing"
      },
      {
        "symbol": "GBK.KW",
        "companyName": "Gulf Bank"
      },
      {
        "symbol": "MABANEE.KW",
        "companyName": "Mabanee"
      },
      {
        "symbol": "HUMANSOFT.KW",
        "companyName": "Humansoft Holding"
      }
    ]
  },
  {
    "name": "Egyptian Exchange (EGX)",
    "stocks": [
      {
        "symbol": "COMI.CA",
        "companyName": "Commercial International Bank"
      },
      {
        "symbol": "FWRY.CA",
        "companyName": "Fawry"
      },
      {
        "symbol": "HRHO.CA",
        "companyName": "EFG Holding"
      },
      {
        "symbol": "JUFO.CA",
        "companyName": "Juhayna Food Industries"
      }
    ]
  },
  {
    "name": "New Zealand Exchange (NZX)",
    "stocks": [
      {
        "symbol": "FPH.NZ",
        "companyName": "Fisher and Paykel Healthcare"
      },
      {
        "symbol": "AIA.NZ",
        "companyName": "Auckland International Airport"
      },
      {
        "symbol": "MEL.NZ",
        "companyName": "Meridian Energy"
      },
      {
        "symbol": "MFT.NZ",
        "companyName": "Mainfreight"
      },
      {
        "symbol": "IFT.NZ",
        "companyName": "Infratil"
      },
      {
        "symbol": "EBO.NZ",
        "companyName": "EBOS Group"
      },
      {
        "symbol": "CEN.NZ",
        "companyName": "Contact Energy"
      },
      {
        "symbol": "SPK.NZ",
        "companyName": "Spark New Zealand"
      },
      {
        "symbol": "MCY.NZ",
        "companyName": "Mercury NZ"
      },
      {
        "symbol": "RYM.NZ",
        "companyName": "Ryman Healthcare"
      },
      {
        "symbol": "ATM.NZ",
        "companyName": "The a2 Milk Company"
      },
      {
        "symbol": "FBU.NZ",
        "companyName": "Fletcher Building"
      }
    ]
  },
  {
    "name": "Pakistan Stock Exchange (PSX)",
    "stocks": [
      {
        "symbol": "LUCK.KA",
        "companyName": "Lucky Cement"
      },
      {
        "symbol": "HBL.KA",
        "companyName": "Habib Bank"
      },
      {
        "symbol": "PPL.KA",
        "companyName": "Pakistan Petroleum"
      },
      {
        "symbol": "MEBL.KA",
        "companyName": "Meezan Bank"
      }
    ]
  },
  {
    "name": "Prague Stock Exchange (Czech Republic)",
    "stocks": [
      {
        "symbol": "CEZ.PR",
        "companyName": "CEZ a.s."
      },
      {
        "symbol": "KOMB.PR",
        "companyName": "Komercni banka a.s."
      }
    ]
  },
  {
    "name": "Budapest Stock Exchange (Hungary)",
    "stocks": [
      {
        "symbol": "OTP.BD",
        "companyName": "OTP Bank Nyrt."
      },
      {
        "symbol": "MOL.BD",
        "companyName": "MOL Magyar Olaj- es Gazipari Nyrt."
      },
      {
        "symbol": "RICHT.BD",
        "companyName": "Gedeon Richter Plc."
      },
      {
        "symbol": "MTEL.BD",
        "companyName": "Magyar Telekom"
      },
      {
        "symbol": "4IG.BD",
        "companyName": "4iG Nyrt."
      },
      {
        "symbol": "OPUS.BD",
        "companyName": "OPUS GLOBAL Nyrt."
      }
    ]
  },
  {
    "name": "Bucharest Stock Exchange (Romania)",
    "stocks": [
      {
        "symbol": "TLV.RO",
        "companyName": "Banca Transilvania S.A."
      },
      {
        "symbol": "SNP.RO",
        "companyName": "OMV Petrom S.A."
      },
      {
        "symbol": "SNG.RO",
        "companyName": "SNGN Romgaz SA"
      },
      {
        "symbol": "SNN.RO",
        "companyName": "S.N. Nuclearelectrica S.A."
      },
      {
        "symbol": "H2O.RO",
        "companyName": "Hidroelectrica S.A."
      },
      {
        "symbol": "BRD.RO",
        "companyName": "BRD - Groupe Societe Generale S.A."
      },
      {
        "symbol": "BVB.RO",
        "companyName": "Bursa de Valori Bucuresti SA"
      }
    ]
  },
  {
    "name": "Athens Stock Exchange (Greece)",
    "stocks": [
      {
        "symbol": "ETE.AT",
        "companyName": "National Bank of Greece S.A."
      },
      {
        "symbol": "EUROB.AT",
        "companyName": "Eurobank Ergasias Services and Holdings S.A."
      },
      {
        "symbol": "ALPHA.AT",
        "companyName": "Alpha Services and Holdings S.A."
      },
      {
        "symbol": "TPEIR.AT",
        "companyName": "Piraeus Financial Holdings S.A."
      },
      {
        "symbol": "HTO.AT",
        "companyName": "Hellenic Telecommunications Organization (OTE)"
      },
      {
        "symbol": "BELA.AT",
        "companyName": "Jumbo S.A."
      },
      {
        "symbol": "MYTIL.AT",
        "companyName": "Metlen Energy and Metals"
      },
      {
        "symbol": "MOH.AT",
        "companyName": "Motor Oil (Hellas) Corinth Refineries S.A."
      },
      {
        "symbol": "PPC.AT",
        "companyName": "Public Power Corporation S.A."
      },
      {
        "symbol": "ALWN.AT",
        "companyName": "Allwyn AG"
      },
      {
        "symbol": "TITC.AT",
        "companyName": "Titan S.A."
      }
    ]
  },
  {
    "name": "US Expansion (S&P 400/600, added 2026-08-10)",
    "stocks": [
      {
        "symbol": "AAON",
        "companyName": "AAON"
      },
      {
        "symbol": "ACI",
        "companyName": "Albertsons"
      },
      {
        "symbol": "ACM",
        "companyName": "AECOM"
      },
      {
        "symbol": "ADC",
        "companyName": "Agree Realty"
      },
      {
        "symbol": "AEIS",
        "companyName": "Advanced Energy"
      },
      {
        "symbol": "AFG",
        "companyName": "American Financial Group"
      },
      {
        "symbol": "AGCO",
        "companyName": "AGCO"
      },
      {
        "symbol": "AHR",
        "companyName": "American Healthcare REIT"
      },
      {
        "symbol": "AIT",
        "companyName": "Applied Industrial Technologies"
      },
      {
        "symbol": "ALGM",
        "companyName": "Allegro MicroSystems"
      },
      {
        "symbol": "ALK",
        "companyName": "Alaska Air Group"
      },
      {
        "symbol": "ALLY",
        "companyName": "Ally Financial"
      },
      {
        "symbol": "ALSN",
        "companyName": "Allison Transmission"
      },
      {
        "symbol": "ALV",
        "companyName": "Autoliv"
      },
      {
        "symbol": "AM",
        "companyName": "Antero Midstream"
      },
      {
        "symbol": "AMG",
        "companyName": "Affiliated Managers Group"
      },
      {
        "symbol": "AMH",
        "companyName": "American Homes 4 Rent"
      },
      {
        "symbol": "AMKR",
        "companyName": "Amkor Technology"
      },
      {
        "symbol": "AN",
        "companyName": "AutoNation"
      },
      {
        "symbol": "ANF",
        "companyName": "Abercrombie & Fitch"
      },
      {
        "symbol": "APG",
        "companyName": "APi Group"
      },
      {
        "symbol": "APPF",
        "companyName": "AppFolio"
      },
      {
        "symbol": "AR",
        "companyName": "Antero Resources"
      },
      {
        "symbol": "ARMK",
        "companyName": "Aramark"
      },
      {
        "symbol": "ARW",
        "companyName": "Arrow Electronics"
      },
      {
        "symbol": "ARWR",
        "companyName": "Arrowhead Pharmaceuticals"
      },
      {
        "symbol": "ASB",
        "companyName": "Associated Bank"
      },
      {
        "symbol": "ASH",
        "companyName": "Ashland Global"
      },
      {
        "symbol": "ATI",
        "companyName": "ATI Inc."
      },
      {
        "symbol": "ATR",
        "companyName": "AptarGroup"
      },
      {
        "symbol": "AVAV",
        "companyName": "AeroVironment"
      },
      {
        "symbol": "AVNT",
        "companyName": "Avient"
      },
      {
        "symbol": "AVT",
        "companyName": "Avnet"
      },
      {
        "symbol": "AVTR",
        "companyName": "Avantor"
      },
      {
        "symbol": "AXTA",
        "companyName": "Axalta"
      },
      {
        "symbol": "AYI",
        "companyName": "Acuity Brands"
      },
      {
        "symbol": "BAH",
        "companyName": "Booz Allen Hamilton"
      },
      {
        "symbol": "BBWI",
        "companyName": "Bath & Body Works, Inc."
      },
      {
        "symbol": "BC",
        "companyName": "Brunswick"
      },
      {
        "symbol": "BCO",
        "companyName": "Brink's"
      },
      {
        "symbol": "BDC",
        "companyName": "Belden Inc."
      },
      {
        "symbol": "BHF",
        "companyName": "Brighthouse Financial"
      },
      {
        "symbol": "BILL",
        "companyName": "Bill Holdings"
      },
      {
        "symbol": "BIO",
        "companyName": "Bio-Rad Laboratories"
      },
      {
        "symbol": "BJ",
        "companyName": "BJ's Wholesale Club"
      },
      {
        "symbol": "BKH",
        "companyName": "Black Hills Corporation"
      },
      {
        "symbol": "BMRN",
        "companyName": "BioMarin Pharmaceutical"
      },
      {
        "symbol": "BRKR",
        "companyName": "Bruker"
      },
      {
        "symbol": "BROS",
        "companyName": "Dutch Bros Inc."
      },
      {
        "symbol": "BRX",
        "companyName": "Brixmor Property Group"
      },
      {
        "symbol": "BSY",
        "companyName": "Bentley Systems"
      },
      {
        "symbol": "BTSG",
        "companyName": "BrightSpring Health Services"
      },
      {
        "symbol": "BURL",
        "companyName": "Burlington Stores"
      },
      {
        "symbol": "BWA",
        "companyName": "BorgWarner"
      },
      {
        "symbol": "BYD",
        "companyName": "Boyd Gaming"
      },
      {
        "symbol": "CACI",
        "companyName": "CACI International"
      },
      {
        "symbol": "CAR",
        "companyName": "Avis Budget Group"
      },
      {
        "symbol": "CAVA",
        "companyName": "Cava Group"
      },
      {
        "symbol": "CBSH",
        "companyName": "Commerce Bancshares"
      },
      {
        "symbol": "CBT",
        "companyName": "Cabot Corp"
      },
      {
        "symbol": "CCK",
        "companyName": "Crown Holdings"
      },
      {
        "symbol": "CDE",
        "companyName": "Coeur Mining"
      },
      {
        "symbol": "CDP",
        "companyName": "COPT Defense Properties"
      },
      {
        "symbol": "CFR",
        "companyName": "Frost Bank"
      },
      {
        "symbol": "CG",
        "companyName": "Carlyle Group (The)"
      },
      {
        "symbol": "CHDN",
        "companyName": "Churchill Downs Inc."
      },
      {
        "symbol": "CHE",
        "companyName": "Chemed Corp."
      },
      {
        "symbol": "CHH",
        "companyName": "Choice Hotels"
      },
      {
        "symbol": "CHRD",
        "companyName": "Chord Energy"
      },
      {
        "symbol": "CHWY",
        "companyName": "Chewy"
      },
      {
        "symbol": "CLF",
        "companyName": "Cleveland-Cliffs"
      },
      {
        "symbol": "CLH",
        "companyName": "Clean Harbors"
      },
      {
        "symbol": "CMC",
        "companyName": "Commercial Metals"
      },
      {
        "symbol": "CNH",
        "companyName": "CNH Industrial"
      },
      {
        "symbol": "CNM",
        "companyName": "Core & Main"
      },
      {
        "symbol": "CNO",
        "companyName": "CNO Financial Group"
      },
      {
        "symbol": "CNX",
        "companyName": "CNX Resources"
      },
      {
        "symbol": "COKE",
        "companyName": "Coca-Cola Consolidated"
      },
      {
        "symbol": "COLB",
        "companyName": "Columbia Banking System"
      },
      {
        "symbol": "COLM",
        "companyName": "Columbia Sportswear"
      },
      {
        "symbol": "CPRI",
        "companyName": "Capri Holdings"
      },
      {
        "symbol": "CR",
        "companyName": "Crane"
      },
      {
        "symbol": "CRBG",
        "companyName": "Corebridge Financial"
      },
      {
        "symbol": "CROX",
        "companyName": "Crocs"
      },
      {
        "symbol": "CRS",
        "companyName": "Carpenter Technology"
      },
      {
        "symbol": "CRUS",
        "companyName": "Cirrus Logic"
      },
      {
        "symbol": "CSL",
        "companyName": "Carlisle Companies"
      },
      {
        "symbol": "CTRE",
        "companyName": "CareTrust REIT"
      },
      {
        "symbol": "CUBE",
        "companyName": "CubeSmart"
      },
      {
        "symbol": "CUZ",
        "companyName": "Cousins Properties"
      },
      {
        "symbol": "CVLT",
        "companyName": "CommVault Systems"
      },
      {
        "symbol": "CW",
        "companyName": "Curtiss-Wright"
      },
      {
        "symbol": "CXT",
        "companyName": "Crane NXT"
      },
      {
        "symbol": "CYTK",
        "companyName": "Cytokinetics"
      },
      {
        "symbol": "DCI",
        "companyName": "Donaldson Company"
      },
      {
        "symbol": "DINO",
        "companyName": "HF Sinclair"
      },
      {
        "symbol": "DKS",
        "companyName": "Dick's Sporting Goods"
      },
      {
        "symbol": "DLB",
        "companyName": "Dolby"
      },
      {
        "symbol": "DOCN",
        "companyName": "DigitalOcean"
      },
      {
        "symbol": "DOCS",
        "companyName": "Doximity"
      },
      {
        "symbol": "DT",
        "companyName": "Dynatrace"
      },
      {
        "symbol": "DTM",
        "companyName": "DT Midstream"
      },
      {
        "symbol": "DY",
        "companyName": "Dycom Industries"
      },
      {
        "symbol": "EEFT",
        "companyName": "Euronet Worldwide"
      },
      {
        "symbol": "EGP",
        "companyName": "EastGroup Properties"
      },
      {
        "symbol": "EHC",
        "companyName": "Encompass Health"
      },
      {
        "symbol": "ELAN",
        "companyName": "Elanco"
      },
      {
        "symbol": "ELS",
        "companyName": "Equity Lifestyle Properties"
      },
      {
        "symbol": "ENS",
        "companyName": "EnerSys"
      },
      {
        "symbol": "ENSG",
        "companyName": "Ensign Group"
      },
      {
        "symbol": "EPR",
        "companyName": "EPR Properties"
      },
      {
        "symbol": "EQH",
        "companyName": "Equitable Holdings"
      },
      {
        "symbol": "ESAB",
        "companyName": "ESAB"
      },
      {
        "symbol": "ESNT",
        "companyName": "Essent Group Ltd."
      },
      {
        "symbol": "EVR",
        "companyName": "Evercore"
      },
      {
        "symbol": "EWBC",
        "companyName": "East West Bancorp"
      },
      {
        "symbol": "EXEL",
        "companyName": "Exelixis"
      },
      {
        "symbol": "EXLS",
        "companyName": "EXL Service"
      },
      {
        "symbol": "EXP",
        "companyName": "Eagle Materials"
      },
      {
        "symbol": "EXPO",
        "companyName": "Exponent, Inc."
      },
      {
        "symbol": "FAF",
        "companyName": "First American Financial Corporation"
      },
      {
        "symbol": "FBIN",
        "companyName": "Fortune Brands Innovations"
      },
      {
        "symbol": "FCFS",
        "companyName": "FirstCash"
      },
      {
        "symbol": "FCN",
        "companyName": "FTI Consulting"
      },
      {
        "symbol": "FFIN",
        "companyName": "First Financial Bankshares"
      },
      {
        "symbol": "FHI",
        "companyName": "Federated Hermes"
      },
      {
        "symbol": "FHN",
        "companyName": "First Horizon"
      },
      {
        "symbol": "FIVE",
        "companyName": "Five Below"
      },
      {
        "symbol": "FLG",
        "companyName": "Flagstar Bank"
      },
      {
        "symbol": "FLR",
        "companyName": "Fluor"
      },
      {
        "symbol": "FLS",
        "companyName": "Flowserve"
      },
      {
        "symbol": "FN",
        "companyName": "Fabrinet"
      },
      {
        "symbol": "FNB",
        "companyName": "FNB Corporation"
      },
      {
        "symbol": "FND",
        "companyName": "Floor & Decor"
      },
      {
        "symbol": "FNF",
        "companyName": "Fidelity National Financial"
      },
      {
        "symbol": "FOUR",
        "companyName": "Shift4"
      },
      {
        "symbol": "FR",
        "companyName": "First Industrial Realty Trust"
      },
      {
        "symbol": "FTI",
        "companyName": "TechnipFMC"
      },
      {
        "symbol": "G",
        "companyName": "Genpact"
      },
      {
        "symbol": "GAP",
        "companyName": "Gap Inc."
      },
      {
        "symbol": "GATX",
        "companyName": "GATX"
      },
      {
        "symbol": "GBCI",
        "companyName": "Glacier Bancorp"
      },
      {
        "symbol": "GEF",
        "companyName": "Greif, Inc."
      },
      {
        "symbol": "GGG",
        "companyName": "Graco Inc."
      },
      {
        "symbol": "GHC",
        "companyName": "Graham Holdings"
      },
      {
        "symbol": "GLPI",
        "companyName": "Gaming and Leisure Properties"
      },
      {
        "symbol": "GMED",
        "companyName": "Globus Medical"
      },
      {
        "symbol": "GNTX",
        "companyName": "Gentex"
      },
      {
        "symbol": "GPK",
        "companyName": "Graphic Packaging"
      },
      {
        "symbol": "GWRE",
        "companyName": "Guidewire Software"
      },
      {
        "symbol": "GXO",
        "companyName": "GXO Logistics"
      },
      {
        "symbol": "H",
        "companyName": "Hyatt"
      },
      {
        "symbol": "HAE",
        "companyName": "Haemonetics"
      },
      {
        "symbol": "HALO",
        "companyName": "Halozyme"
      },
      {
        "symbol": "HGV",
        "companyName": "Hilton Grand Vacations"
      },
      {
        "symbol": "HIMS",
        "companyName": "Hims & Hers Health"
      },
      {
        "symbol": "HL",
        "companyName": "Hecla Mining"
      },
      {
        "symbol": "HLI",
        "companyName": "Houlihan Lokey"
      },
      {
        "symbol": "HLNE",
        "companyName": "Hamilton Lane"
      },
      {
        "symbol": "HOG",
        "companyName": "Harley-Davidson"
      },
      {
        "symbol": "HOMB",
        "companyName": "Home BancShares"
      },
      {
        "symbol": "HQY",
        "companyName": "HealthEquity"
      },
      {
        "symbol": "HR",
        "companyName": "Healthcare Realty Trust"
      },
      {
        "symbol": "HRB",
        "companyName": "H&R Block"
      },
      {
        "symbol": "HWC",
        "companyName": "Hancock Whitney"
      },
      {
        "symbol": "HXL",
        "companyName": "Hexcel"
      },
      {
        "symbol": "IBOC",
        "companyName": "Intl Bancshares Corp"
      },
      {
        "symbol": "IDA",
        "companyName": "Idacorp"
      },
      {
        "symbol": "IDCC",
        "companyName": "InterDigital"
      },
      {
        "symbol": "IESC",
        "companyName": "IES Holdings"
      },
      {
        "symbol": "IPGP",
        "companyName": "IPG Photonics"
      },
      {
        "symbol": "IRT",
        "companyName": "Independence Realty Trust"
      },
      {
        "symbol": "ITT",
        "companyName": "ITT Inc."
      },
      {
        "symbol": "JAZZ",
        "companyName": "Jazz Pharmaceuticals"
      },
      {
        "symbol": "JEF",
        "companyName": "Jefferies"
      },
      {
        "symbol": "JLL",
        "companyName": "Jones Lang LaSalle"
      },
      {
        "symbol": "KBH",
        "companyName": "KB Home"
      },
      {
        "symbol": "KBR",
        "companyName": "KBR, Inc."
      },
      {
        "symbol": "KD",
        "companyName": "Kyndryl"
      },
      {
        "symbol": "KEX",
        "companyName": "Kirby Corporation"
      },
      {
        "symbol": "KNF",
        "companyName": "Knife River Corporation"
      },
      {
        "symbol": "KNSL",
        "companyName": "Kinsale Capital Group"
      },
      {
        "symbol": "KNX",
        "companyName": "Knight-Swift"
      },
      {
        "symbol": "KRC",
        "companyName": "Kilroy Realty Corp"
      },
      {
        "symbol": "KRG",
        "companyName": "Kite Realty Group Trust"
      },
      {
        "symbol": "KRYS",
        "companyName": "Krystal Biotech"
      },
      {
        "symbol": "LAD",
        "companyName": "Lithia Motors"
      },
      {
        "symbol": "LAMR",
        "companyName": "Lamar Advertising Company"
      },
      {
        "symbol": "LEA",
        "companyName": "Lear"
      },
      {
        "symbol": "LECO",
        "companyName": "Lincoln Electric"
      },
      {
        "symbol": "LFUS",
        "companyName": "Littelfuse"
      },
      {
        "symbol": "LIVN",
        "companyName": "LivaNova"
      },
      {
        "symbol": "LNTH",
        "companyName": "Lantheus Holdings"
      },
      {
        "symbol": "LOPE",
        "companyName": "Grand Canyon Education"
      },
      {
        "symbol": "LPX",
        "companyName": "Louisiana-Pacific"
      },
      {
        "symbol": "LSCC",
        "companyName": "Lattice Semiconductor"
      },
      {
        "symbol": "LSTR",
        "companyName": "Landstar System"
      },
      {
        "symbol": "M",
        "companyName": "Macy's"
      },
      {
        "symbol": "MANH",
        "companyName": "Manhattan Associates"
      },
      {
        "symbol": "MAT",
        "companyName": "Mattel"
      },
      {
        "symbol": "MEDP",
        "companyName": "Medpace"
      },
      {
        "symbol": "MIDD",
        "companyName": "Middleby"
      },
      {
        "symbol": "MLI",
        "companyName": "Mueller Industries"
      },
      {
        "symbol": "MMS",
        "companyName": "Maximus Inc."
      },
      {
        "symbol": "MOG-A",
        "companyName": "Moog Inc."
      },
      {
        "symbol": "MOH",
        "companyName": "Molina Healthcare"
      },
      {
        "symbol": "MORN",
        "companyName": "Morningstar, Inc."
      },
      {
        "symbol": "MP",
        "companyName": "MP Materials"
      },
      {
        "symbol": "MSA",
        "companyName": "MSA Safety"
      },
      {
        "symbol": "MSM",
        "companyName": "MSC Industrial Direct"
      },
      {
        "symbol": "MTDR",
        "companyName": "Matador Resources"
      },
      {
        "symbol": "MTG",
        "companyName": "MGIC Investment Corporation"
      },
      {
        "symbol": "MTN",
        "companyName": "Vail Resorts"
      },
      {
        "symbol": "MTSI",
        "companyName": "MACOM Technology Solutions"
      },
      {
        "symbol": "MTZ",
        "companyName": "MasTec"
      },
      {
        "symbol": "MUR",
        "companyName": "Murphy Oil"
      },
      {
        "symbol": "MUSA",
        "companyName": "Murphy USA"
      },
      {
        "symbol": "MZTI",
        "companyName": "The Marzetti Company"
      },
      {
        "symbol": "NBIX",
        "companyName": "Neurocrine Biosciences"
      },
      {
        "symbol": "NEU",
        "companyName": "NewMarket Corporation"
      },
      {
        "symbol": "NFG",
        "companyName": "National Fuel Gas"
      },
      {
        "symbol": "NJR",
        "companyName": "New Jersey Resources"
      },
      {
        "symbol": "NLY",
        "companyName": "Annaly Capital Management"
      },
      {
        "symbol": "NNN",
        "companyName": "NNN Reit"
      },
      {
        "symbol": "NOV",
        "companyName": "NOV Inc."
      },
      {
        "symbol": "NOVT",
        "companyName": "Novanta"
      },
      {
        "symbol": "NTNX",
        "companyName": "Nutanix"
      },
      {
        "symbol": "NVST",
        "companyName": "Envista Holdings"
      },
      {
        "symbol": "NWE",
        "companyName": "NorthWestern Energy"
      },
      {
        "symbol": "NXST",
        "companyName": "Nexstar Media Group"
      },
      {
        "symbol": "NXT",
        "companyName": "Nextpower"
      },
      {
        "symbol": "NYT",
        "companyName": "New York Times Company"
      },
      {
        "symbol": "OC",
        "companyName": "Owens Corning"
      },
      {
        "symbol": "OGE",
        "companyName": "OGE Energy"
      },
      {
        "symbol": "OGS",
        "companyName": "One Gas"
      },
      {
        "symbol": "OHI",
        "companyName": "Omega Healthcare Investors"
      },
      {
        "symbol": "OLED",
        "companyName": "Universal Display"
      },
      {
        "symbol": "OLLI",
        "companyName": "Ollie's Bargain Outlet"
      },
      {
        "symbol": "OLN",
        "companyName": "Olin Corporation"
      },
      {
        "symbol": "ONB",
        "companyName": "Old National Bank"
      },
      {
        "symbol": "ONTO",
        "companyName": "Onto Innovation"
      },
      {
        "symbol": "OPCH",
        "companyName": "Option Care Health"
      },
      {
        "symbol": "ORA",
        "companyName": "Ormat Technologies"
      },
      {
        "symbol": "ORI",
        "companyName": "Old Republic International"
      },
      {
        "symbol": "OSK",
        "companyName": "Oshkosh"
      },
      {
        "symbol": "OVV",
        "companyName": "Ovintiv"
      },
      {
        "symbol": "OZK",
        "companyName": "Bank OZK"
      },
      {
        "symbol": "P",
        "companyName": "Everpure"
      },
      {
        "symbol": "PAG",
        "companyName": "Penske Automotive Group"
      },
      {
        "symbol": "PATH",
        "companyName": "UiPath"
      },
      {
        "symbol": "PB",
        "companyName": "Prosperity Bancshares"
      },
      {
        "symbol": "PBF",
        "companyName": "PBF Energy"
      },
      {
        "symbol": "PCTY",
        "companyName": "Paylocity"
      },
      {
        "symbol": "PEGA",
        "companyName": "Pegasystems"
      },
      {
        "symbol": "PEN",
        "companyName": "Penumbra, Inc."
      },
      {
        "symbol": "PFGC",
        "companyName": "Performance Food Group"
      },
      {
        "symbol": "PII",
        "companyName": "Polaris"
      },
      {
        "symbol": "PK",
        "companyName": "Park Hotels & Resorts"
      },
      {
        "symbol": "PLNT",
        "companyName": "Planet Fitness"
      },
      {
        "symbol": "PNFP",
        "companyName": "Pinnacle Financial Partners"
      },
      {
        "symbol": "POR",
        "companyName": "Portland General Electric"
      },
      {
        "symbol": "POST",
        "companyName": "Post Holdings"
      },
      {
        "symbol": "PPC",
        "companyName": "Pilgrim's Pride"
      },
      {
        "symbol": "PR",
        "companyName": "Permian Resources"
      },
      {
        "symbol": "PRI",
        "companyName": "Primerica"
      },
      {
        "symbol": "PSN",
        "companyName": "Parsons Corporation"
      },
      {
        "symbol": "PVH",
        "companyName": "PVH Corp."
      },
      {
        "symbol": "R",
        "companyName": "Ryder"
      },
      {
        "symbol": "RBA",
        "companyName": "RB Global"
      },
      {
        "symbol": "RBC",
        "companyName": "RBC Bearings"
      },
      {
        "symbol": "REXR",
        "companyName": "Rexford Industrial Realty"
      },
      {
        "symbol": "RGA",
        "companyName": "Reinsurance Group of America"
      },
      {
        "symbol": "RGEN",
        "companyName": "Repligen"
      },
      {
        "symbol": "RGLD",
        "companyName": "Royal Gold"
      },
      {
        "symbol": "RLI",
        "companyName": "RLI Corp."
      },
      {
        "symbol": "RMBS",
        "companyName": "Rambus"
      },
      {
        "symbol": "RNR",
        "companyName": "RenaissanceRe"
      },
      {
        "symbol": "ROIV",
        "companyName": "Roivant Sciences"
      },
      {
        "symbol": "RPM",
        "companyName": "RPM International"
      },
      {
        "symbol": "RRC",
        "companyName": "Range Resources"
      },
      {
        "symbol": "RRX",
        "companyName": "Regal Rexnord"
      },
      {
        "symbol": "RS",
        "companyName": "Reliance, Inc."
      },
      {
        "symbol": "RYAN",
        "companyName": "Ryan Specialty"
      },
      {
        "symbol": "RYN",
        "companyName": "Rayonier"
      },
      {
        "symbol": "SAIA",
        "companyName": "Saia"
      },
      {
        "symbol": "SAIC",
        "companyName": "Science Applications Intl Corp"
      },
      {
        "symbol": "SAM",
        "companyName": "Boston Beer Company"
      },
      {
        "symbol": "SANM",
        "companyName": "Sanmina Corporation"
      },
      {
        "symbol": "SARO",
        "companyName": "StandardAero"
      },
      {
        "symbol": "SBRA",
        "companyName": "Sabra Health Care REIT"
      },
      {
        "symbol": "SCI",
        "companyName": "Service Corp Intl"
      },
      {
        "symbol": "SEIC",
        "companyName": "SEI Investments Company"
      },
      {
        "symbol": "SF",
        "companyName": "Stifel"
      },
      {
        "symbol": "SFM",
        "companyName": "Sprouts Farmers Market"
      },
      {
        "symbol": "SGI",
        "companyName": "Somnigroup International"
      },
      {
        "symbol": "SHC",
        "companyName": "Sotera Health"
      },
      {
        "symbol": "SIGI",
        "companyName": "Selective Insurance Group"
      },
      {
        "symbol": "SITM",
        "companyName": "SiTime"
      },
      {
        "symbol": "SLAB",
        "companyName": "Silicon Labs"
      },
      {
        "symbol": "SLGN",
        "companyName": "Silgan Holdings"
      },
      {
        "symbol": "SLM",
        "companyName": "SLM Corp"
      },
      {
        "symbol": "SMG",
        "companyName": "Scotts Miracle-Gro Company"
      },
      {
        "symbol": "SMTC",
        "companyName": "Semtech"
      },
      {
        "symbol": "SN",
        "companyName": "SharkNinja"
      },
      {
        "symbol": "SNX",
        "companyName": "TD Synnex"
      },
      {
        "symbol": "SOLS",
        "companyName": "Solstice Advanced Materials"
      },
      {
        "symbol": "SON",
        "companyName": "Sonoco"
      },
      {
        "symbol": "SPXC",
        "companyName": "SPX Technologies"
      },
      {
        "symbol": "SR",
        "companyName": "Spire"
      },
      {
        "symbol": "SSB",
        "companyName": "South State Bank"
      },
      {
        "symbol": "SSD",
        "companyName": "Simpson Manufacturing"
      },
      {
        "symbol": "ST",
        "companyName": "Sensata Technologies"
      },
      {
        "symbol": "STAG",
        "companyName": "STAG Industrial"
      },
      {
        "symbol": "STRL",
        "companyName": "Sterling Infrastructure"
      },
      {
        "symbol": "STWD",
        "companyName": "Starwood Property Trust"
      },
      {
        "symbol": "SWX",
        "companyName": "Southwest Gas Corp"
      },
      {
        "symbol": "SYNA",
        "companyName": "Synaptics"
      },
      {
        "symbol": "TCBI",
        "companyName": "Texas Capital Bancshares"
      },
      {
        "symbol": "TEX",
        "companyName": "Terex"
      },
      {
        "symbol": "THC",
        "companyName": "Tenet Health"
      },
      {
        "symbol": "THG",
        "companyName": "Hanover Insurance"
      },
      {
        "symbol": "THO",
        "companyName": "Thor Industries"
      },
      {
        "symbol": "TKR",
        "companyName": "Timken"
      },
      {
        "symbol": "TLN",
        "companyName": "Talen Energy"
      },
      {
        "symbol": "TNL",
        "companyName": "Travel + Leisure Co."
      },
      {
        "symbol": "TOL",
        "companyName": "Toll Brothers"
      },
      {
        "symbol": "TOST",
        "companyName": "Toast, Inc."
      },
      {
        "symbol": "TREX",
        "companyName": "Trex"
      },
      {
        "symbol": "TRU",
        "companyName": "TransUnion"
      },
      {
        "symbol": "TTC",
        "companyName": "Toro"
      },
      {
        "symbol": "TTEK",
        "companyName": "Tetra Tech"
      },
      {
        "symbol": "TTMI",
        "companyName": "TTM Technologies"
      },
      {
        "symbol": "TXNM",
        "companyName": "TXNM Energy"
      },
      {
        "symbol": "TXRH",
        "companyName": "Texas Roadhouse"
      },
      {
        "symbol": "UBSI",
        "companyName": "United Bankshares"
      },
      {
        "symbol": "UFPI",
        "companyName": "UFP Industries"
      },
      {
        "symbol": "UGI",
        "companyName": "UGI Corp"
      },
      {
        "symbol": "ULS",
        "companyName": "UL Solutions"
      },
      {
        "symbol": "UMBF",
        "companyName": "UMB Financial Corp."
      },
      {
        "symbol": "UNM",
        "companyName": "Unum"
      },
      {
        "symbol": "USFD",
        "companyName": "US Foods"
      },
      {
        "symbol": "UTHR",
        "companyName": "United Therapeutics"
      },
      {
        "symbol": "VC",
        "companyName": "Visteon"
      },
      {
        "symbol": "VFC",
        "companyName": "VF Corporation"
      },
      {
        "symbol": "VIAV",
        "companyName": "Viavi Solutions"
      },
      {
        "symbol": "VICR",
        "companyName": "Vicor Corporation"
      },
      {
        "symbol": "VLY",
        "companyName": "Valley Bank"
      },
      {
        "symbol": "VMI",
        "companyName": "Valmont Industries"
      },
      {
        "symbol": "VNO",
        "companyName": "Vornado Realty Trust"
      },
      {
        "symbol": "VNOM",
        "companyName": "Viper Energy"
      },
      {
        "symbol": "VNT",
        "companyName": "Vontier"
      },
      {
        "symbol": "VOYA",
        "companyName": "Voya Financial"
      },
      {
        "symbol": "VVV",
        "companyName": "Valvoline"
      },
      {
        "symbol": "WAL",
        "companyName": "Western Alliance Bancorporation"
      },
      {
        "symbol": "WBS",
        "companyName": "Webster Bank"
      },
      {
        "symbol": "WCC",
        "companyName": "WESCO International"
      },
      {
        "symbol": "WEX",
        "companyName": "WEX Inc."
      },
      {
        "symbol": "WFRD",
        "companyName": "Weatherford International"
      },
      {
        "symbol": "WH",
        "companyName": "Wyndham Hotels & Resorts"
      },
      {
        "symbol": "WHR",
        "companyName": "Whirlpool Corporation"
      },
      {
        "symbol": "WING",
        "companyName": "Wingstop"
      },
      {
        "symbol": "WLK",
        "companyName": "Westlake Corporation"
      },
      {
        "symbol": "WMG",
        "companyName": "Warner Music Group"
      },
      {
        "symbol": "WMS",
        "companyName": "Advanced Drainage Systems"
      },
      {
        "symbol": "WPC",
        "companyName": "W. P. Carey"
      },
      {
        "symbol": "WSO",
        "companyName": "Watsco"
      },
      {
        "symbol": "WTFC",
        "companyName": "Wintrust Financial"
      },
      {
        "symbol": "WTS",
        "companyName": "Watts Water Technologies"
      },
      {
        "symbol": "WWD",
        "companyName": "Woodward, Inc."
      },
      {
        "symbol": "XPO",
        "companyName": "XPO, Inc."
      },
      {
        "symbol": "XRAY",
        "companyName": "Dentsply Sirona"
      },
      {
        "symbol": "YETI",
        "companyName": "Yeti Holdings"
      },
      {
        "symbol": "ZION",
        "companyName": "Zions Bancorporation"
      },
      {
        "symbol": "AAMI",
        "companyName": "Acadian Asset Management Inc."
      },
      {
        "symbol": "AAP",
        "companyName": "Advance Auto Parts, Inc."
      },
      {
        "symbol": "AAT",
        "companyName": "American Assets Trust"
      },
      {
        "symbol": "ABCB",
        "companyName": "Ameris Bancorp"
      },
      {
        "symbol": "ABG",
        "companyName": "Asbury Automotive Group"
      },
      {
        "symbol": "ABM",
        "companyName": "ABM Industries, Inc."
      },
      {
        "symbol": "ABR",
        "companyName": "Arbor Realty Trust"
      },
      {
        "symbol": "ACA",
        "companyName": "Arcosa, Inc."
      },
      {
        "symbol": "ACAD",
        "companyName": "Acadia Pharmaceuticals"
      },
      {
        "symbol": "ACHC",
        "companyName": "Acadia Healthcare"
      },
      {
        "symbol": "ACIW",
        "companyName": "ACI Worldwide"
      },
      {
        "symbol": "ACLS",
        "companyName": "Axcelis Technologies, Inc."
      },
      {
        "symbol": "ACMR",
        "companyName": "ACM Research, Inc."
      },
      {
        "symbol": "ACT",
        "companyName": "Enact Holdings, Inc."
      },
      {
        "symbol": "ADAM",
        "companyName": "Adamas Trust, Inc."
      },
      {
        "symbol": "ADEA",
        "companyName": "Adeia, Inc."
      },
      {
        "symbol": "ADMA",
        "companyName": "ADMA Biologics, Inc."
      },
      {
        "symbol": "ADNT",
        "companyName": "Adient"
      },
      {
        "symbol": "ADT",
        "companyName": "ADT Inc."
      },
      {
        "symbol": "ADUS",
        "companyName": "Addus HomeCare Corp."
      },
      {
        "symbol": "AEO",
        "companyName": "American Eagle Outfitters"
      },
      {
        "symbol": "AESI",
        "companyName": "Atlas Energy Solutions, Inc."
      },
      {
        "symbol": "AGNT",
        "companyName": "eXp World Holdings, Inc."
      },
      {
        "symbol": "AGO",
        "companyName": "Assured Guaranty Ltd."
      },
      {
        "symbol": "AGX",
        "companyName": "Argan, Inc."
      },
      {
        "symbol": "AGYS",
        "companyName": "Agilysys, Inc."
      },
      {
        "symbol": "AHCO",
        "companyName": "AdaptHealth Corp."
      },
      {
        "symbol": "AIN",
        "companyName": "Albany International Corp."
      },
      {
        "symbol": "AIR",
        "companyName": "AAR Corp."
      },
      {
        "symbol": "AKR",
        "companyName": "Acadia Realty Trust"
      },
      {
        "symbol": "ALG",
        "companyName": "Alamo Group"
      },
      {
        "symbol": "ALGT",
        "companyName": "Allegiant Travel Company"
      },
      {
        "symbol": "ALHC",
        "companyName": "Alignment Healthcare, Inc."
      },
      {
        "symbol": "ALKS",
        "companyName": "Alkermes plc"
      },
      {
        "symbol": "ALRM",
        "companyName": "Alarm.Com, Inc."
      },
      {
        "symbol": "AMN",
        "companyName": "Amn Healthcare Services, Inc."
      },
      {
        "symbol": "AMPH",
        "companyName": "Amphstar Pharmaceuticals, Inc."
      },
      {
        "symbol": "AMR",
        "companyName": "Alpha Metallurgical Resources, Inc."
      },
      {
        "symbol": "AMRX",
        "companyName": "Amneal Pharmaceuticals"
      },
      {
        "symbol": "AMSF",
        "companyName": "Amerisafe, Inc."
      },
      {
        "symbol": "AMTM",
        "companyName": "Amentum"
      },
      {
        "symbol": "ANIP",
        "companyName": "ANI Pharmaceuticals, Inc."
      },
      {
        "symbol": "AORT",
        "companyName": "Artivion"
      },
      {
        "symbol": "AOSL",
        "companyName": "Alpha and Omega Semiconductor, Ltd."
      },
      {
        "symbol": "APAM",
        "companyName": "Artisan Partners Asset Management, Inc."
      },
      {
        "symbol": "APLE",
        "companyName": "Apple Hospitality REIT, Inc."
      },
      {
        "symbol": "APOG",
        "companyName": "Apogee Enterprises, Inc."
      },
      {
        "symbol": "ARCB",
        "companyName": "ArcBest Corp."
      },
      {
        "symbol": "ARLO",
        "companyName": "Arlo Technologies"
      },
      {
        "symbol": "AROC",
        "companyName": "Archrock, Inc."
      },
      {
        "symbol": "ARR",
        "companyName": "Armour Residential REIT"
      },
      {
        "symbol": "ASO",
        "companyName": "Academy Sports + Outdoors"
      },
      {
        "symbol": "ASTE",
        "companyName": "Astec Industries, Inc."
      },
      {
        "symbol": "ASTH",
        "companyName": "Astrana Health, Inc."
      },
      {
        "symbol": "ATEN",
        "companyName": "A10 Networks, Inc."
      },
      {
        "symbol": "ATMU",
        "companyName": "Atmus Filtration Technologies Inc."
      },
      {
        "symbol": "AUB",
        "companyName": "Atlantic Union Bankshares, Corp."
      },
      {
        "symbol": "AVA",
        "companyName": "Avista Corporation"
      },
      {
        "symbol": "AWI",
        "companyName": "Armstrong World Industries, Inc."
      },
      {
        "symbol": "AWR",
        "companyName": "American States Water Company"
      },
      {
        "symbol": "AX",
        "companyName": "Axos Financial, Inc."
      },
      {
        "symbol": "AZTA",
        "companyName": "Azenta, Inc."
      },
      {
        "symbol": "AZZ",
        "companyName": "AZZ, Inc."
      },
      {
        "symbol": "BANC",
        "companyName": "Banc Of California, Inc."
      },
      {
        "symbol": "BANF",
        "companyName": "Bancfirst Corp"
      },
      {
        "symbol": "BANR",
        "companyName": "Banner Corporation"
      },
      {
        "symbol": "BBT",
        "companyName": "Beacon Financial Corp."
      },
      {
        "symbol": "BCC",
        "companyName": "Boise Cascade"
      },
      {
        "symbol": "BCPC",
        "companyName": "Balchem Corporation"
      },
      {
        "symbol": "BFAM",
        "companyName": "Bright Horizons Family Solutions Inc."
      },
      {
        "symbol": "BFH",
        "companyName": "Bread Financial Holdings, Inc."
      },
      {
        "symbol": "BFS",
        "companyName": "Saul Centers, Inc."
      },
      {
        "symbol": "BGC",
        "companyName": "BGC Group, Inc."
      },
      {
        "symbol": "BHE",
        "companyName": "Benchmark Electronics, Inc."
      },
      {
        "symbol": "BJRI",
        "companyName": "BJ's Restaurants, Inc."
      },
      {
        "symbol": "BKE",
        "companyName": "The Buckle, Inc."
      },
      {
        "symbol": "BKU",
        "companyName": "BankUnited, Inc."
      },
      {
        "symbol": "BL",
        "companyName": "BlackLine Systems, Inc."
      },
      {
        "symbol": "BLFS",
        "companyName": "BioLife Solutions, Inc."
      },
      {
        "symbol": "BLKB",
        "companyName": "Blackbaud"
      },
      {
        "symbol": "BMI",
        "companyName": "Badger Meter, Inc."
      },
      {
        "symbol": "BNL",
        "companyName": "Broadstone Net Lease, Inc."
      },
      {
        "symbol": "BOH",
        "companyName": "Bank of Hawaii"
      },
      {
        "symbol": "BOOT",
        "companyName": "Boot Barn Holdings, Inc."
      },
      {
        "symbol": "BOX",
        "companyName": "Box, Inc."
      },
      {
        "symbol": "BRC",
        "companyName": "Brady Corporation"
      },
      {
        "symbol": "BTU",
        "companyName": "Peabody Energy, Inc."
      },
      {
        "symbol": "BXMT",
        "companyName": "Blackstone Mortgage Trust, Inc."
      },
      {
        "symbol": "CACC",
        "companyName": "Credit Acceptance"
      },
      {
        "symbol": "CAKE",
        "companyName": "The Cheesecake Factory, Inc."
      },
      {
        "symbol": "CALM",
        "companyName": "Cal-Maine Foods, Inc."
      },
      {
        "symbol": "CALX",
        "companyName": "Calix"
      },
      {
        "symbol": "CALY",
        "companyName": "Callaway Golf Company"
      },
      {
        "symbol": "CARG",
        "companyName": "CarGurus"
      },
      {
        "symbol": "CASH",
        "companyName": "Pathward Financial, Inc."
      },
      {
        "symbol": "CATY",
        "companyName": "Cathay General Bancorp"
      },
      {
        "symbol": "CBRL",
        "companyName": "Cracker Barrel"
      },
      {
        "symbol": "CBU",
        "companyName": "Community Bank System, Inc."
      },
      {
        "symbol": "CC",
        "companyName": "Chemours"
      },
      {
        "symbol": "CCOI",
        "companyName": "Cogent Communications Holdings, Inc."
      },
      {
        "symbol": "CCS",
        "companyName": "Century Communities, Inc."
      },
      {
        "symbol": "CE",
        "companyName": "Celanese"
      },
      {
        "symbol": "CENT",
        "companyName": "Central Garden & Pet Company"
      },
      {
        "symbol": "CENTA",
        "companyName": "Central Garden & Pet Company (Class A)"
      },
      {
        "symbol": "CENX",
        "companyName": "Century Aluminum Company"
      },
      {
        "symbol": "CERT",
        "companyName": "Certara, Inc."
      },
      {
        "symbol": "CFFN",
        "companyName": "Capitol Federal Savings Bank"
      },
      {
        "symbol": "CHCO",
        "companyName": "City Holding Company"
      },
      {
        "symbol": "CHEF",
        "companyName": "Chefs' Warehouse, Inc."
      },
      {
        "symbol": "CLSK",
        "companyName": "CleanSpark, Inc."
      },
      {
        "symbol": "CNK",
        "companyName": "Cinemark Holdings, Inc."
      },
      {
        "symbol": "CNMD",
        "companyName": "CONMED Corporation"
      },
      {
        "symbol": "CNR",
        "companyName": "Core Natural Resources, Inc."
      },
      {
        "symbol": "CNS",
        "companyName": "Cohen & Steers, Inc."
      },
      {
        "symbol": "CNXC",
        "companyName": "Concentrix"
      },
      {
        "symbol": "CNXN",
        "companyName": "PC Connection, Inc."
      },
      {
        "symbol": "COCO",
        "companyName": "The Vita Coco Company"
      },
      {
        "symbol": "COHU",
        "companyName": "Cohu, Inc."
      },
      {
        "symbol": "COLL",
        "companyName": "Collegium Pharmaceutical, Inc."
      },
      {
        "symbol": "CON",
        "companyName": "Concentra Group Holdings Parent, Inc."
      },
      {
        "symbol": "CORT",
        "companyName": "Corcept Therapeutics Incorporated"
      },
      {
        "symbol": "CPB",
        "companyName": "The Campbell's Company"
      },
      {
        "symbol": "CPF",
        "companyName": "Central Pacific Financial Corp."
      },
      {
        "symbol": "CPK",
        "companyName": "Chesapeake Utilities Corp."
      },
      {
        "symbol": "CRC",
        "companyName": "California Resources Corporation"
      },
      {
        "symbol": "CRGY",
        "companyName": "Crescent Energy Company"
      },
      {
        "symbol": "CRI",
        "companyName": "Carter's, Inc."
      },
      {
        "symbol": "CRK",
        "companyName": "Comstock Resources, Inc."
      },
      {
        "symbol": "CRSR",
        "companyName": "Corsair Gaming"
      },
      {
        "symbol": "CRVL",
        "companyName": "CorVel Corporation"
      },
      {
        "symbol": "CSR",
        "companyName": "Centerspace Trust"
      },
      {
        "symbol": "CSW",
        "companyName": "CSW Industrials, Inc."
      },
      {
        "symbol": "CTS",
        "companyName": "CTS Corporation"
      },
      {
        "symbol": "CUBI",
        "companyName": "Customers Bancorp, Inc."
      },
      {
        "symbol": "CURB",
        "companyName": "Curbline Properties Corp."
      },
      {
        "symbol": "CVBF",
        "companyName": "CVB Financial Corp."
      },
      {
        "symbol": "CVCO",
        "companyName": "Cavco Industries, Inc."
      },
      {
        "symbol": "CVI",
        "companyName": "CVR Energy, Inc."
      },
      {
        "symbol": "CVSA",
        "companyName": "Covista Inc."
      },
      {
        "symbol": "CWEN",
        "companyName": "Clearway Energy, Inc. (Class C)"
      },
      {
        "symbol": "CWK",
        "companyName": "Cushman & Wakefield plc"
      },
      {
        "symbol": "CWST",
        "companyName": "Casella Waste Systems, Inc."
      },
      {
        "symbol": "CWT",
        "companyName": "California Water Service Group"
      },
      {
        "symbol": "CXM",
        "companyName": "Sprinklr, Inc."
      },
      {
        "symbol": "CXW",
        "companyName": "CoreCivic"
      },
      {
        "symbol": "DAN",
        "companyName": "Dana Incorporated"
      },
      {
        "symbol": "DAVE",
        "companyName": "Dave, Inc."
      },
      {
        "symbol": "DBD",
        "companyName": "Diebold Nixdorf"
      },
      {
        "symbol": "DCH",
        "companyName": "Dauch Corporation"
      },
      {
        "symbol": "DCOM",
        "companyName": "Dime Community Bancshares, Inc."
      },
      {
        "symbol": "DEA",
        "companyName": "Easterly Government Properties, Inc."
      },
      {
        "symbol": "DEI",
        "companyName": "Douglas Emmett"
      },
      {
        "symbol": "DFH",
        "companyName": "Dream Finders Homes, Inc."
      },
      {
        "symbol": "DFIN",
        "companyName": "Donnelley Financial Solutions, Inc."
      },
      {
        "symbol": "DGII",
        "companyName": "Digi International Inc."
      },
      {
        "symbol": "DIOD",
        "companyName": "Diodes Incorporated"
      },
      {
        "symbol": "DLX",
        "companyName": "Deluxe Corporation"
      },
      {
        "symbol": "DMC",
        "companyName": "Del Monte Corporation"
      },
      {
        "symbol": "DNOW",
        "companyName": "NOW Inc"
      },
      {
        "symbol": "DORM",
        "companyName": "Dorman Products, Inc."
      },
      {
        "symbol": "DRH",
        "companyName": "DiamondRock Hospitality Company"
      },
      {
        "symbol": "DV",
        "companyName": "DoubleVerify Holdings Inc."
      },
      {
        "symbol": "DXC",
        "companyName": "DXC Technology"
      },
      {
        "symbol": "DXPE",
        "companyName": "DXP Enterprises, Inc."
      },
      {
        "symbol": "EAT",
        "companyName": "Brinker International, Inc."
      },
      {
        "symbol": "EBC",
        "companyName": "Eastern Bankshares, Inc."
      },
      {
        "symbol": "ECG",
        "companyName": "Everus Construction Group, Inc."
      },
      {
        "symbol": "ECPG",
        "companyName": "Encore Capital Group, Inc."
      },
      {
        "symbol": "EFC",
        "companyName": "Ellington Financial, Inc."
      },
      {
        "symbol": "EFOR",
        "companyName": "Everforth Inc."
      },
      {
        "symbol": "EGBN",
        "companyName": "Eagle Bancorp Inc"
      },
      {
        "symbol": "EIG",
        "companyName": "Employers Holdings, Inc."
      },
      {
        "symbol": "EMN",
        "companyName": "Eastman Chemical Company"
      },
      {
        "symbol": "ENOV",
        "companyName": "Enovis"
      },
      {
        "symbol": "ENR",
        "companyName": "Energizer"
      },
      {
        "symbol": "ENVA",
        "companyName": "Enova International, Inc."
      },
      {
        "symbol": "EPAC",
        "companyName": "Enerpac Tool Group"
      },
      {
        "symbol": "EPAM",
        "companyName": "EPAM Systems"
      },
      {
        "symbol": "EPC",
        "companyName": "Edgewell Personal Care"
      },
      {
        "symbol": "EPRT",
        "companyName": "Essential Properties Realty Trust, Inc."
      },
      {
        "symbol": "ESE",
        "companyName": "ESCO Technologies Inc."
      },
      {
        "symbol": "ESI",
        "companyName": "Element Solutions"
      },
      {
        "symbol": "EVTC",
        "companyName": "EVERTEC, Inc."
      },
      {
        "symbol": "EXTR",
        "companyName": "Extreme Networks, Inc."
      },
      {
        "symbol": "EYE",
        "companyName": "National Vision Holdings"
      },
      {
        "symbol": "EZPW",
        "companyName": "EZCORP, Inc."
      },
      {
        "symbol": "FA",
        "companyName": "First Advantage Corporation"
      },
      {
        "symbol": "FBK",
        "companyName": "FB Financial Corp."
      },
      {
        "symbol": "FBNC",
        "companyName": "First Bancorp (Southern Pines NC)"
      },
      {
        "symbol": "FBP",
        "companyName": "First BanCorp (Puerto Rico)"
      },
      {
        "symbol": "FBRT",
        "companyName": "Franklin BSP Realty Trust, Inc."
      },
      {
        "symbol": "FCF",
        "companyName": "First Commonwealth Financial, Corp."
      },
      {
        "symbol": "FCPT",
        "companyName": "Four Corners Property Trust, Inc."
      },
      {
        "symbol": "FELE",
        "companyName": "Franklin Electric"
      },
      {
        "symbol": "FFBC",
        "companyName": "First Financial Bancorp"
      },
      {
        "symbol": "FG",
        "companyName": "F&G Annuities & Life, Inc."
      },
      {
        "symbol": "FHB",
        "companyName": "First Hawaiian, Inc."
      },
      {
        "symbol": "FIBK",
        "companyName": "First Interstate BancSystem, Inc."
      },
      {
        "symbol": "FIVN",
        "companyName": "Five9, Inc."
      },
      {
        "symbol": "FIZZ",
        "companyName": "National Beverage Corp."
      },
      {
        "symbol": "FLO",
        "companyName": "Flowers Foods"
      },
      {
        "symbol": "FMC",
        "companyName": "FMC Corporation"
      },
      {
        "symbol": "FORM",
        "companyName": "FormFactor, Inc."
      },
      {
        "symbol": "FOXF",
        "companyName": "Fox Factory"
      },
      {
        "symbol": "FRPT",
        "companyName": "Freshpet"
      },
      {
        "symbol": "FSS",
        "companyName": "Federal Signal Corporation"
      },
      {
        "symbol": "FTDR",
        "companyName": "Frontdoor, Inc."
      },
      {
        "symbol": "FTRE",
        "companyName": "Fortrea"
      },
      {
        "symbol": "FUL",
        "companyName": "H.B. Fuller Company"
      },
      {
        "symbol": "FULT",
        "companyName": "Fulton Financial Corporation"
      },
      {
        "symbol": "FUN",
        "companyName": "Six Flags"
      },
      {
        "symbol": "GBX",
        "companyName": "The Greenbrier Companies, Inc."
      },
      {
        "symbol": "GEO",
        "companyName": "GEO Group, Inc."
      },
      {
        "symbol": "GFF",
        "companyName": "Griffon Corporation"
      },
      {
        "symbol": "GIII",
        "companyName": "G-III Apparel Group, Ltd."
      },
      {
        "symbol": "GKOS",
        "companyName": "Glaukos Corp."
      },
      {
        "symbol": "GNL",
        "companyName": "Global Net Lease, Inc."
      },
      {
        "symbol": "GNW",
        "companyName": "Genworth Financial, Inc."
      },
      {
        "symbol": "GO",
        "companyName": "Grocery Outlet"
      },
      {
        "symbol": "GOLF",
        "companyName": "Acushnet Company"
      },
      {
        "symbol": "GPI",
        "companyName": "Group 1 Automotive, Inc."
      },
      {
        "symbol": "GPOR",
        "companyName": "Gulfport Energy Corporation"
      },
      {
        "symbol": "GRBK",
        "companyName": "Green Brick Partners, Inc."
      },
      {
        "symbol": "GSHD",
        "companyName": "Goosehead Insurance, Inc."
      },
      {
        "symbol": "GT",
        "companyName": "Goodyear Tire and Rubber Company"
      },
      {
        "symbol": "GTES",
        "companyName": "Gates Corporation"
      },
      {
        "symbol": "GTM",
        "companyName": "ZoomInfo"
      },
      {
        "symbol": "GTY",
        "companyName": "Getty Realty Corp."
      },
      {
        "symbol": "GVA",
        "companyName": "Granite Construction, Inc."
      },
      {
        "symbol": "HAFC",
        "companyName": "Hanmi Financial Corporation"
      },
      {
        "symbol": "HASI",
        "companyName": "Hannon Armstrong Sustainable Infrastructure Capital, Inc."
      },
      {
        "symbol": "HAYW",
        "companyName": "Hayward Holdings, Inc."
      },
      {
        "symbol": "HCC",
        "companyName": "Warrior Met Coal, Inc."
      },
      {
        "symbol": "HCI",
        "companyName": "HCI Group, Inc."
      },
      {
        "symbol": "HCSG",
        "companyName": "Healthcare Services Group, Inc."
      },
      {
        "symbol": "HE",
        "companyName": "Hawaiian Electric Industries, Inc."
      },
      {
        "symbol": "HFWA",
        "companyName": "Heritage Financial Corporation"
      },
      {
        "symbol": "HIW",
        "companyName": "Highwoods Properties"
      },
      {
        "symbol": "HLIT",
        "companyName": "Harmonic Inc."
      },
      {
        "symbol": "HLX",
        "companyName": "Helix Energy Solutions Group, Inc."
      },
      {
        "symbol": "HMN",
        "companyName": "Horace Mann Educators Corporation"
      },
      {
        "symbol": "HNI",
        "companyName": "HNI Corporation"
      },
      {
        "symbol": "HOPE",
        "companyName": "Hope Bancorp, Inc."
      },
      {
        "symbol": "HP",
        "companyName": "Helmerich & Payne, Inc."
      },
      {
        "symbol": "HRMY",
        "companyName": "Harmony Biosciences Holdings, Inc."
      },
      {
        "symbol": "HSTM",
        "companyName": "HealthStream, Inc."
      },
      {
        "symbol": "HTH",
        "companyName": "Hilltop Holdings Inc."
      },
      {
        "symbol": "HTLD",
        "companyName": "Heartland Express, Inc."
      },
      {
        "symbol": "HTO",
        "companyName": "H2O America"
      },
      {
        "symbol": "HTZ",
        "companyName": "Hertz"
      },
      {
        "symbol": "HUBG",
        "companyName": "Hub Group, Inc."
      },
      {
        "symbol": "HWKN",
        "companyName": "Hawkins, Inc."
      },
      {
        "symbol": "HZO",
        "companyName": "MarineMax, Inc."
      },
      {
        "symbol": "IART",
        "companyName": "Integra Lifesciences Holdings"
      },
      {
        "symbol": "IBP",
        "companyName": "Installed Building Products, Inc."
      },
      {
        "symbol": "ICHR",
        "companyName": "Ichor Holdings, Ltd."
      },
      {
        "symbol": "ICUI",
        "companyName": "ICU Medical"
      },
      {
        "symbol": "IIPR",
        "companyName": "Innovative Industrial Properties, Inc."
      },
      {
        "symbol": "INDB",
        "companyName": "Independent Bank Corp."
      },
      {
        "symbol": "INDV",
        "companyName": "Indivior"
      },
      {
        "symbol": "INSP",
        "companyName": "Inspire Medical Systems, Inc."
      },
      {
        "symbol": "INSW",
        "companyName": "International Seaways, Inc."
      },
      {
        "symbol": "INVA",
        "companyName": "Innoviva, Inc."
      },
      {
        "symbol": "INVX",
        "companyName": "Innovex International, Inc."
      },
      {
        "symbol": "IOSP",
        "companyName": "Innospec, Inc."
      },
      {
        "symbol": "IPAR",
        "companyName": "Inter Parfums, Inc."
      },
      {
        "symbol": "ITGR",
        "companyName": "Integer Holdings Corporation"
      },
      {
        "symbol": "ITRI",
        "companyName": "Itron, Inc."
      },
      {
        "symbol": "IVT",
        "companyName": "InvenTrust Properties"
      },
      {
        "symbol": "JBGS",
        "companyName": "JBG Smith"
      },
      {
        "symbol": "JBLU",
        "companyName": "JetBlue"
      },
      {
        "symbol": "JBSS",
        "companyName": "John B. Sanfilippo & Son, Inc."
      },
      {
        "symbol": "JBTM",
        "companyName": "JBT Marel Corporation"
      },
      {
        "symbol": "JJSF",
        "companyName": "J&J Snack Foods Corp."
      },
      {
        "symbol": "JOE",
        "companyName": "St. Joe Company"
      },
      {
        "symbol": "JXN",
        "companyName": "Jackson Financial, Inc."
      },
      {
        "symbol": "KAI",
        "companyName": "Kadant Inc."
      },
      {
        "symbol": "KALU",
        "companyName": "Kaiser Aluminum Corporation"
      },
      {
        "symbol": "KFY",
        "companyName": "Korn/Ferry International"
      },
      {
        "symbol": "KGS",
        "companyName": "Kodiak Gas Services, Inc."
      },
      {
        "symbol": "KLIC",
        "companyName": "Kulicke and Soffa Industries, Inc."
      },
      {
        "symbol": "KMPR",
        "companyName": "Kemper Corporation"
      },
      {
        "symbol": "KMT",
        "companyName": "Kennametal"
      },
      {
        "symbol": "KN",
        "companyName": "Knowles Corporation"
      },
      {
        "symbol": "KNTK",
        "companyName": "Kinetik Holdings, Inc."
      },
      {
        "symbol": "KOP",
        "companyName": "Koppers Holdings, Inc."
      },
      {
        "symbol": "KRMN",
        "companyName": "Karman Holdings"
      },
      {
        "symbol": "KSS",
        "companyName": "Kohl's Corp."
      },
      {
        "symbol": "KTB",
        "companyName": "Kontoor Brands"
      },
      {
        "symbol": "KWR",
        "companyName": "Quaker Chemical Corporation"
      },
      {
        "symbol": "LAUR",
        "companyName": "Laureate Education, Inc."
      },
      {
        "symbol": "LAZ",
        "companyName": "Lazard"
      },
      {
        "symbol": "LBRT",
        "companyName": "Liberty Energy, Inc."
      },
      {
        "symbol": "LCII",
        "companyName": "LCI Industries"
      },
      {
        "symbol": "LEG",
        "companyName": "Leggett & Platt"
      },
      {
        "symbol": "LEU",
        "companyName": "Centrus Energy Corp."
      },
      {
        "symbol": "LFST",
        "companyName": "Lifestance Health"
      },
      {
        "symbol": "LGIH",
        "companyName": "LGI Homes"
      },
      {
        "symbol": "LIF",
        "companyName": "Life360"
      },
      {
        "symbol": "LGND",
        "companyName": "Ligand Pharmaceuticals, Inc."
      },
      {
        "symbol": "LKFN",
        "companyName": "Lakeland Financial"
      },
      {
        "symbol": "LKQ",
        "companyName": "LKQ Corporation"
      },
      {
        "symbol": "LMAT",
        "companyName": "LeMaitre Vascular"
      },
      {
        "symbol": "LNC",
        "companyName": "Lincoln Financial"
      },
      {
        "symbol": "LNN",
        "companyName": "Lindsay Corporation"
      },
      {
        "symbol": "LPG",
        "companyName": "Dorian LPG Ltd."
      },
      {
        "symbol": "LQDA",
        "companyName": "Liquidia Corporation"
      },
      {
        "symbol": "LQDT",
        "companyName": "Liquidity Services, Inc."
      },
      {
        "symbol": "LRN",
        "companyName": "Stride, Inc."
      },
      {
        "symbol": "LTC",
        "companyName": "LTC Properties, Inc."
      },
      {
        "symbol": "LTH",
        "companyName": "Life Time Group Holdings, Inc."
      },
      {
        "symbol": "LUMN",
        "companyName": "Lumen Technologies"
      },
      {
        "symbol": "LW",
        "companyName": "Lamb Weston"
      },
      {
        "symbol": "LXP",
        "companyName": "Lexington Realty Trust"
      },
      {
        "symbol": "LZ",
        "companyName": "LegalZoom.com, Inc."
      },
      {
        "symbol": "LZB",
        "companyName": "La-Z-Boy, Inc."
      },
      {
        "symbol": "MAC",
        "companyName": "Macerich"
      },
      {
        "symbol": "MAN",
        "companyName": "ManpowerGroup"
      },
      {
        "symbol": "MATW",
        "companyName": "Matthews International Corporation"
      },
      {
        "symbol": "MATX",
        "companyName": "Matson, Inc."
      },
      {
        "symbol": "MBC",
        "companyName": "MasterBrand, Inc."
      },
      {
        "symbol": "MBGL",
        "companyName": "Mobility Global, Inc."
      },
      {
        "symbol": "MBIN",
        "companyName": "Merchants Bancorp"
      },
      {
        "symbol": "MC",
        "companyName": "Moelis & Company"
      },
      {
        "symbol": "MCRI",
        "companyName": "Monarch Casino & Resort, Inc."
      },
      {
        "symbol": "MCY",
        "companyName": "Mercury General"
      },
      {
        "symbol": "MD",
        "companyName": "Pediatrix Medical Group"
      },
      {
        "symbol": "MDU",
        "companyName": "MDU Resources Group, Inc."
      },
      {
        "symbol": "MFP",
        "companyName": "Midera Food Processing, Inc."
      },
      {
        "symbol": "MGEE",
        "companyName": "MGE Energy, Inc."
      },
      {
        "symbol": "MGY",
        "companyName": "Magnolia Oil & Gas, Corp."
      },
      {
        "symbol": "MHK",
        "companyName": "Mohawk Industries"
      },
      {
        "symbol": "MHO",
        "companyName": "M/I Homes, Inc."
      },
      {
        "symbol": "MIR",
        "companyName": "Mirion Technologies, Inc."
      },
      {
        "symbol": "MKTX",
        "companyName": "MarketAxess"
      },
      {
        "symbol": "MLKN",
        "companyName": "MillerKnoll, Inc."
      },
      {
        "symbol": "MMI",
        "companyName": "Marcus & Millichap, Inc."
      },
      {
        "symbol": "MMSI",
        "companyName": "Merit Medical Systems, Inc."
      },
      {
        "symbol": "MPT",
        "companyName": "Medical Properties Trust"
      },
      {
        "symbol": "MRCY",
        "companyName": "Mercury Systems"
      },
      {
        "symbol": "MRP",
        "companyName": "Millrose Properties, Inc."
      },
      {
        "symbol": "MRTN",
        "companyName": "Marten Transport, Ltd."
      },
      {
        "symbol": "MSEX",
        "companyName": "Middlesex Water Company"
      },
      {
        "symbol": "MSGS",
        "companyName": "Madison Square Garden Sports Corp."
      },
      {
        "symbol": "MTCH",
        "companyName": "Match Group"
      },
      {
        "symbol": "MTH",
        "companyName": "Meritage Homes Corporation"
      },
      {
        "symbol": "MTRN",
        "companyName": "Materion Corp."
      },
      {
        "symbol": "MTUS",
        "companyName": "Metallus Inc"
      },
      {
        "symbol": "MTX",
        "companyName": "Minerals Technologies"
      },
      {
        "symbol": "MWA",
        "companyName": "Mueller Water Products"
      },
      {
        "symbol": "MXL",
        "companyName": "MaxLinear, Inc."
      },
      {
        "symbol": "MYRG",
        "companyName": "MYR Group, Inc."
      },
      {
        "symbol": "NABL",
        "companyName": "N-able, Inc."
      },
      {
        "symbol": "NATL",
        "companyName": "NCR Atleos"
      },
      {
        "symbol": "NAVI",
        "companyName": "Navient"
      },
      {
        "symbol": "NBHC",
        "companyName": "National Bank Holdings Corporation"
      },
      {
        "symbol": "NBTB",
        "companyName": "NBT Bancorp, Inc."
      },
      {
        "symbol": "NEO",
        "companyName": "NeoGenomics Laboratories, Inc."
      },
      {
        "symbol": "NEOG",
        "companyName": "Neogen"
      },
      {
        "symbol": "NGVT",
        "companyName": "Ingevity, Corp."
      },
      {
        "symbol": "NHC",
        "companyName": "National Healthcare, Corp."
      },
      {
        "symbol": "NHI",
        "companyName": "National Health Investors, Inc."
      },
      {
        "symbol": "NIC",
        "companyName": "Nicolet Bankshares"
      },
      {
        "symbol": "NMIH",
        "companyName": "NMI Holdings, Inc."
      },
      {
        "symbol": "NOG",
        "companyName": "Northern Oil and Gas, Inc."
      },
      {
        "symbol": "NPK",
        "companyName": "National Presto Industries, Inc."
      },
      {
        "symbol": "NPO",
        "companyName": "EnPro Industries, Inc."
      },
      {
        "symbol": "NSIT",
        "companyName": "Insight Enterprises, Inc."
      },
      {
        "symbol": "NSP",
        "companyName": "Insperity"
      },
      {
        "symbol": "NSSC",
        "companyName": "Napco Security Technologies"
      },
      {
        "symbol": "NTCT",
        "companyName": "NETSCOUT Systems, Inc."
      },
      {
        "symbol": "NTST",
        "companyName": "NETSTREIT Corp."
      },
      {
        "symbol": "NWBI",
        "companyName": "Northwest Bancshares, Inc."
      },
      {
        "symbol": "NWL",
        "companyName": "Newell Brands"
      },
      {
        "symbol": "NWN",
        "companyName": "NW Natural"
      },
      {
        "symbol": "NX",
        "companyName": "Quanex Building Products Corporation"
      },
      {
        "symbol": "NXRT",
        "companyName": "NexPoint Residential Trust, Inc."
      },
      {
        "symbol": "OFG",
        "companyName": "OFG Bancorp"
      },
      {
        "symbol": "OGN",
        "companyName": "Organon & Co."
      },
      {
        "symbol": "OI",
        "companyName": "O-I Glass, Inc."
      },
      {
        "symbol": "OII",
        "companyName": "Oceaneering International, Inc."
      },
      {
        "symbol": "OMCL",
        "companyName": "Omnicell"
      },
      {
        "symbol": "OPLN",
        "companyName": "OPENLANE, Inc."
      },
      {
        "symbol": "OSIS",
        "companyName": "OSI Systems, Inc."
      },
      {
        "symbol": "OSW",
        "companyName": "OneSpaWorld Holdings Limited"
      },
      {
        "symbol": "OTTR",
        "companyName": "Otter Tail Corporation"
      },
      {
        "symbol": "OUT",
        "companyName": "Outfront Media"
      },
      {
        "symbol": "PAHC",
        "companyName": "Phibro Animal Health"
      },
      {
        "symbol": "PARR",
        "companyName": "Par Pacific Holdings, Inc."
      },
      {
        "symbol": "PAYC",
        "companyName": "Paycom"
      },
      {
        "symbol": "PAYO",
        "companyName": "Payoneer Global Inc."
      },
      {
        "symbol": "PATK",
        "companyName": "Patrick Industries, Inc."
      },
      {
        "symbol": "PBH",
        "companyName": "Prestige Consumer Healthcare"
      },
      {
        "symbol": "PBI",
        "companyName": "Pitney Bowes, Inc."
      },
      {
        "symbol": "PCRX",
        "companyName": "Pacira BioSciences, Inc."
      },
      {
        "symbol": "PDFS",
        "companyName": "PDF Solutions, Inc."
      },
      {
        "symbol": "PEB",
        "companyName": "Pebblebrook Hotel Trust"
      },
      {
        "symbol": "PECO",
        "companyName": "Phillips Edison & Company"
      },
      {
        "symbol": "PENG",
        "companyName": "Penguin Solutions, Inc."
      },
      {
        "symbol": "PFBC",
        "companyName": "Preferred Bank"
      },
      {
        "symbol": "PFS",
        "companyName": "Provident Financial Services, Inc."
      },
      {
        "symbol": "PGNY",
        "companyName": "Progyny, Inc."
      },
      {
        "symbol": "PHIN",
        "companyName": "PHINIA, Inc."
      },
      {
        "symbol": "PI",
        "companyName": "Impinj, Inc."
      },
      {
        "symbol": "PIPR",
        "companyName": "Piper Sandler Companies"
      },
      {
        "symbol": "PJT",
        "companyName": "PJT Partners, Inc."
      },
      {
        "symbol": "PLAB",
        "companyName": "Photronics, Inc."
      },
      {
        "symbol": "PLMR",
        "companyName": "Palomar Holdings, Inc."
      },
      {
        "symbol": "PLUS",
        "companyName": "ePlus, Inc."
      },
      {
        "symbol": "PLXS",
        "companyName": "Plexus Corp."
      },
      {
        "symbol": "PMT",
        "companyName": "PennyMac Mortgage Investment Trust"
      },
      {
        "symbol": "POOL",
        "companyName": "Pool Corporation"
      },
      {
        "symbol": "POWI",
        "companyName": "Power Integrations"
      },
      {
        "symbol": "POWL",
        "companyName": "Powell Industries, Inc."
      },
      {
        "symbol": "PPLI",
        "companyName": "People Inc."
      },
      {
        "symbol": "PRDO",
        "companyName": "Perdoceo Education Corp."
      },
      {
        "symbol": "PRG",
        "companyName": "PROG Holdings, Inc."
      },
      {
        "symbol": "PRGO",
        "companyName": "Perrigo"
      },
      {
        "symbol": "PRGS",
        "companyName": "Progress Software Corporation"
      },
      {
        "symbol": "PRIM",
        "companyName": "Primoris Services Corporation"
      },
      {
        "symbol": "PRK",
        "companyName": "Park National Corp."
      },
      {
        "symbol": "PRKS",
        "companyName": "United Parks & Resorts"
      },
      {
        "symbol": "PRLB",
        "companyName": "Protolabs"
      },
      {
        "symbol": "PRSU",
        "companyName": "Pursuit Attractions & Hospitality, Inc."
      },
      {
        "symbol": "PRVA",
        "companyName": "Privia Health Group, Inc."
      },
      {
        "symbol": "PSMT",
        "companyName": "PriceSmart"
      },
      {
        "symbol": "PTCT",
        "companyName": "PTC Therapeutics, Inc."
      },
      {
        "symbol": "PTEN",
        "companyName": "Patterson-UTI Energy, Inc."
      },
      {
        "symbol": "PTGX",
        "companyName": "Protagonist Therapeutics, Inc."
      },
      {
        "symbol": "PTON",
        "companyName": "Peloton Interactive, Inc."
      },
      {
        "symbol": "PZZA",
        "companyName": "Papa John's Pizza"
      },
      {
        "symbol": "QDEL",
        "companyName": "QuidelOrtho"
      },
      {
        "symbol": "QNST",
        "companyName": "QuinStreet, Inc."
      },
      {
        "symbol": "QRVO",
        "companyName": "Qorvo"
      },
      {
        "symbol": "QTWO",
        "companyName": "Q2 Holdings, Inc."
      },
      {
        "symbol": "RAMP",
        "companyName": "LiveRamp Holdings, Inc."
      },
      {
        "symbol": "RAL",
        "companyName": "Ralliant Corp"
      },
      {
        "symbol": "RCUS",
        "companyName": "Arcus Biosciences, Inc."
      },
      {
        "symbol": "RDN",
        "companyName": "Radian Group, Inc."
      },
      {
        "symbol": "RDNT",
        "companyName": "RadNet, Inc."
      },
      {
        "symbol": "RELY",
        "companyName": "Remitly"
      },
      {
        "symbol": "RES",
        "companyName": "RPC, Inc."
      },
      {
        "symbol": "REYN",
        "companyName": "Reynolds Consumer Products"
      },
      {
        "symbol": "REX",
        "companyName": "REX American Resources Corporation"
      },
      {
        "symbol": "REZI",
        "companyName": "Resideo Technologies, Inc."
      },
      {
        "symbol": "RHI",
        "companyName": "Robert Half"
      },
      {
        "symbol": "RHP",
        "companyName": "Ryman Hospitality Properties"
      },
      {
        "symbol": "RITM",
        "companyName": "Rithm Capital"
      },
      {
        "symbol": "RNG",
        "companyName": "RingCentral, Inc."
      },
      {
        "symbol": "RNST",
        "companyName": "Renasant Corp."
      },
      {
        "symbol": "ROAD",
        "companyName": "Construction Partners, Inc."
      },
      {
        "symbol": "ROCK",
        "companyName": "Gibraltar Industries, Inc."
      },
      {
        "symbol": "ROG",
        "companyName": "Rogers Corporation"
      },
      {
        "symbol": "RRR",
        "companyName": "Red Rock Resorts, Inc."
      },
      {
        "symbol": "RSI",
        "companyName": "Rush Street Interactive, Inc."
      },
      {
        "symbol": "RUSHA",
        "companyName": "Rush Enterprises"
      },
      {
        "symbol": "RXO",
        "companyName": "RXO, Inc."
      },
      {
        "symbol": "SAFE",
        "companyName": "Safehold, Inc."
      },
      {
        "symbol": "SABR",
        "companyName": "Sabre"
      },
      {
        "symbol": "SAFT",
        "companyName": "Safety Insurance Group, Inc."
      },
      {
        "symbol": "SAH",
        "companyName": "Sonic Automotive, Inc."
      },
      {
        "symbol": "SBCF",
        "companyName": "Seacoast Banking Corporation of Florida"
      },
      {
        "symbol": "SBH",
        "companyName": "Sally Beauty Holdings, Inc."
      },
      {
        "symbol": "SBSI",
        "companyName": "Southside Bancshares, Inc."
      },
      {
        "symbol": "SCHL",
        "companyName": "Scholastic Corporation"
      },
      {
        "symbol": "SCL",
        "companyName": "Stepan Company"
      },
      {
        "symbol": "SCSC",
        "companyName": "ScanSource, Inc."
      },
      {
        "symbol": "SDGR",
        "companyName": "Schrödinger, Inc."
      },
      {
        "symbol": "SEI",
        "companyName": "Solaris Energy Infrastructure, Inc."
      },
      {
        "symbol": "SEZL",
        "companyName": "Sezzle"
      },
      {
        "symbol": "SFBS",
        "companyName": "ServisFirst Bancshares, Inc."
      },
      {
        "symbol": "SFNC",
        "companyName": "Simmons First National Corporation"
      },
      {
        "symbol": "SHAK",
        "companyName": "Shake Shack, Inc."
      },
      {
        "symbol": "SHEN",
        "companyName": "Shenandoah Telecommunications Co"
      },
      {
        "symbol": "SHO",
        "companyName": "Sunstone Hotel Investors, Inc."
      },
      {
        "symbol": "SHOO",
        "companyName": "Steven Madden, Ltd."
      },
      {
        "symbol": "SIG",
        "companyName": "Signet Jewelers"
      },
      {
        "symbol": "SKT",
        "companyName": "Tanger Factory Outlet Centers, Inc."
      },
      {
        "symbol": "SKY",
        "companyName": "Champion Homes, Inc."
      },
      {
        "symbol": "SKYW",
        "companyName": "SkyWest, Inc."
      },
      {
        "symbol": "SLG",
        "companyName": "SL Green Realty"
      },
      {
        "symbol": "SLVM",
        "companyName": "Sylvamo Corp."
      },
      {
        "symbol": "SM",
        "companyName": "SM Energy Company"
      },
      {
        "symbol": "SMP",
        "companyName": "Standard Motor Products, Inc."
      },
      {
        "symbol": "SMPL",
        "companyName": "Simply Good Foods Company"
      },
      {
        "symbol": "SNDR",
        "companyName": "Schneider National"
      },
      {
        "symbol": "SNEX",
        "companyName": "StoneX Group Inc."
      },
      {
        "symbol": "SONO",
        "companyName": "Sonos, Inc."
      },
      {
        "symbol": "SPHR",
        "companyName": "Sphere Entertainment"
      },
      {
        "symbol": "SPNT",
        "companyName": "SiriusPoint Ltd."
      },
      {
        "symbol": "SPSC",
        "companyName": "SPS Commerce, Inc."
      },
      {
        "symbol": "SRPT",
        "companyName": "Sarepta Therapeutics"
      },
      {
        "symbol": "STAA",
        "companyName": "STAAR Surgical Company"
      },
      {
        "symbol": "STBA",
        "companyName": "S&T Bancorp, Inc."
      },
      {
        "symbol": "STC",
        "companyName": "Stewart Information Services Corporation"
      },
      {
        "symbol": "STEP",
        "companyName": "StepStone Group"
      },
      {
        "symbol": "STRA",
        "companyName": "Strategic Education, Inc."
      },
      {
        "symbol": "SUPN",
        "companyName": "Supernus Pharmaceuticals, Inc."
      },
      {
        "symbol": "SXI",
        "companyName": "Standex International Corporation"
      },
      {
        "symbol": "SXT",
        "companyName": "Sensient Technologies"
      },
      {
        "symbol": "TALO",
        "companyName": "Talos Energy, Inc."
      },
      {
        "symbol": "TBBK",
        "companyName": "The Bancorp, Inc."
      },
      {
        "symbol": "TDC",
        "companyName": "Teradata"
      },
      {
        "symbol": "TDS",
        "companyName": "Telephone and Data Systems, Inc."
      },
      {
        "symbol": "TDW",
        "companyName": "Tidewater, Inc."
      },
      {
        "symbol": "TFIN",
        "companyName": "Triumph Bancorp, Inc."
      },
      {
        "symbol": "TFX",
        "companyName": "Teleflex"
      },
      {
        "symbol": "TGTX",
        "companyName": "TG Therapeutics, Inc."
      },
      {
        "symbol": "THRM",
        "companyName": "Gentherm Incorporated"
      },
      {
        "symbol": "TILE",
        "companyName": "Interface, Inc."
      },
      {
        "symbol": "TMDX",
        "companyName": "TransMedics Group, Inc."
      },
      {
        "symbol": "TMP",
        "companyName": "Tompkins Financial Corporation"
      },
      {
        "symbol": "TNC",
        "companyName": "Tennant Company"
      },
      {
        "symbol": "TNDM",
        "companyName": "Tandem Diabetes Care"
      },
      {
        "symbol": "TPC",
        "companyName": "Tutor Perini Corporation"
      },
      {
        "symbol": "TR",
        "companyName": "Tootsie Roll Industries, Inc."
      },
      {
        "symbol": "TRMK",
        "companyName": "Trustmark Corp."
      },
      {
        "symbol": "TRN",
        "companyName": "Trinity Industries, Inc."
      },
      {
        "symbol": "TRNO",
        "companyName": "Terreno Realty Corporation"
      },
      {
        "symbol": "TRST",
        "companyName": "TrustCo Bank Corp NY"
      },
      {
        "symbol": "TRUP",
        "companyName": "Trupanion"
      },
      {
        "symbol": "UA",
        "companyName": "Under Armour (Class C)"
      },
      {
        "symbol": "UCB",
        "companyName": "United Community Banks, Inc."
      },
      {
        "symbol": "UCTT",
        "companyName": "Ultra Clean Holdings, Inc."
      },
      {
        "symbol": "UE",
        "companyName": "Urban Edge Properties"
      },
      {
        "symbol": "UFCS",
        "companyName": "United Fire Group, Inc."
      },
      {
        "symbol": "UFPT",
        "companyName": "UFP Technologies, Inc."
      },
      {
        "symbol": "UNF",
        "companyName": "UniFirst Corporation"
      },
      {
        "symbol": "UNFI",
        "companyName": "United Natural Foods Inc"
      },
      {
        "symbol": "UNIT",
        "companyName": "Uniti Group"
      },
      {
        "symbol": "UPBD",
        "companyName": "Upbound Group, Inc."
      },
      {
        "symbol": "UPWK",
        "companyName": "Upwork, Inc."
      },
      {
        "symbol": "URBN",
        "companyName": "Urban Outfitters, Inc."
      },
      {
        "symbol": "USLM",
        "companyName": "United States Lime & Minerals, Inc."
      },
      {
        "symbol": "USPH",
        "companyName": "U.S. Physical Therapy, Inc."
      },
      {
        "symbol": "UTI",
        "companyName": "Universal Technical Institute"
      },
      {
        "symbol": "UTL",
        "companyName": "Unitil Corporation"
      },
      {
        "symbol": "UVV",
        "companyName": "Universal Corporation"
      },
      {
        "symbol": "VAC",
        "companyName": "Marriott Vacations Worldwide"
      },
      {
        "symbol": "VCEL",
        "companyName": "Vericel"
      },
      {
        "symbol": "VCTR",
        "companyName": "Victory Capital Holdings, Inc."
      },
      {
        "symbol": "VCYT",
        "companyName": "Veracyte, Inc."
      },
      {
        "symbol": "VECO",
        "companyName": "Veeco Instruments Inc."
      },
      {
        "symbol": "VGNT",
        "companyName": "Versigent PLC"
      },
      {
        "symbol": "VIR",
        "companyName": "Vir Biotechnology, Inc."
      },
      {
        "symbol": "VIRT",
        "companyName": "Virtu Financial, Inc."
      },
      {
        "symbol": "VRRM",
        "companyName": "Verra Mobility Corporation"
      },
      {
        "symbol": "VRTS",
        "companyName": "Virtus Investment Partners, Inc."
      },
      {
        "symbol": "VSEC",
        "companyName": "VSE Corporation"
      },
      {
        "symbol": "VSH",
        "companyName": "Vishay Intertechnology"
      },
      {
        "symbol": "VSNT",
        "companyName": "Versant Media Group, Inc."
      },
      {
        "symbol": "VSTS",
        "companyName": "Vestis"
      },
      {
        "symbol": "VSXY",
        "companyName": "Victoria's Secret"
      },
      {
        "symbol": "VTOL",
        "companyName": "Bristow Group Inc."
      },
      {
        "symbol": "VVX",
        "companyName": "V2X, Inc."
      },
      {
        "symbol": "VYX",
        "companyName": "NCR Voyix"
      },
      {
        "symbol": "WABC",
        "companyName": "Westamerica Bank"
      },
      {
        "symbol": "WAFD",
        "companyName": "WaFd, Inc."
      },
      {
        "symbol": "WAY",
        "companyName": "Waystar Holding Corp"
      },
      {
        "symbol": "WD",
        "companyName": "Walker & Dunlop, Inc."
      },
      {
        "symbol": "WDFC",
        "companyName": "WD-40 Company"
      },
      {
        "symbol": "WEN",
        "companyName": "The Wendy's Company"
      },
      {
        "symbol": "WERN",
        "companyName": "Werner Enterprises"
      },
      {
        "symbol": "WGO",
        "companyName": "Winnebago Industries, Inc."
      },
      {
        "symbol": "WHD",
        "companyName": "Cactus, Inc."
      },
      {
        "symbol": "WINA",
        "companyName": "Winmark"
      },
      {
        "symbol": "WKC",
        "companyName": "World Kinect Corporation"
      },
      {
        "symbol": "WLY",
        "companyName": "John Wiley & Sons"
      },
      {
        "symbol": "WOR",
        "companyName": "Worthington Enterprises"
      },
      {
        "symbol": "WRBY",
        "companyName": "Warby Parker"
      },
      {
        "symbol": "WRLD",
        "companyName": "World Acceptance Corporation"
      },
      {
        "symbol": "WS",
        "companyName": "Worthington Steel"
      },
      {
        "symbol": "WSBC",
        "companyName": "WesBanco"
      },
      {
        "symbol": "WSC",
        "companyName": "WillScot Holdings Corp."
      },
      {
        "symbol": "WSFS",
        "companyName": "WSFS Financial Corporation"
      },
      {
        "symbol": "WT",
        "companyName": "WisdomTree Investments, Inc."
      },
      {
        "symbol": "WU",
        "companyName": "Western Union"
      },
      {
        "symbol": "WWW",
        "companyName": "Wolverine World Wide, Inc."
      },
      {
        "symbol": "XHR",
        "companyName": "Xenia Hotels & Resorts, Inc."
      },
      {
        "symbol": "XNCR",
        "companyName": "Xencor Inc"
      },
      {
        "symbol": "XPEL",
        "companyName": "XPEL, Inc."
      },
      {
        "symbol": "YELP",
        "companyName": "Yelp, Inc."
      },
      {
        "symbol": "YOU",
        "companyName": "Clear Secure, Inc."
      },
      {
        "symbol": "ZD",
        "companyName": "Ziff Davis"
      },
      {
        "symbol": "ZWS",
        "companyName": "Zurn Elkay Water Solutions Corp."
      }
    ]
  },
  {
    "name": "LSE Expansion (FTSE 250, added 2026-08-10)",
    "stocks": [
      {
        "symbol": "3IN.L",
        "companyName": "3i Infrastructure"
      },
      {
        "symbol": "FOUR.L",
        "companyName": "4imprint"
      },
      {
        "symbol": "AAS.L",
        "companyName": "Aberdeen Asia Focus"
      },
      {
        "symbol": "ASL.L",
        "companyName": "Aberforth Smaller Companies Trust"
      },
      {
        "symbol": "AEP.L",
        "companyName": "AEP Plantations"
      },
      {
        "symbol": "ALFA.L",
        "companyName": "Alfa Financial Software"
      },
      {
        "symbol": "ATT.L",
        "companyName": "Allianz Technology Trust"
      },
      {
        "symbol": "AO.L",
        "companyName": "AO World"
      },
      {
        "symbol": "APN.L",
        "companyName": "Applied Nutrition"
      },
      {
        "symbol": "ASHM.L",
        "companyName": "Ashmore Group"
      },
      {
        "symbol": "AIE.L",
        "companyName": "Ashoka India Equity Investment Trust"
      },
      {
        "symbol": "AML.L",
        "companyName": "Aston Martin Lagonda"
      },
      {
        "symbol": "ATYM.L",
        "companyName": "Atalaya Mining"
      },
      {
        "symbol": "ATG.L",
        "companyName": "Auction Technology Group"
      },
      {
        "symbol": "AGT.L",
        "companyName": "AVI Global Trust"
      },
      {
        "symbol": "AVON.L",
        "companyName": "Avon Technologies"
      },
      {
        "symbol": "BGFD.L",
        "companyName": "Baillie Gifford Japan Trust"
      },
      {
        "symbol": "USA.L",
        "companyName": "Baillie Gifford US Growth Trust"
      },
      {
        "symbol": "BCG.L",
        "companyName": "Baltic Classifieds"
      },
      {
        "symbol": "BNKR.L",
        "companyName": "Bankers Investment Trust"
      },
      {
        "symbol": "BAG.L",
        "companyName": "A.G. Barr"
      },
      {
        "symbol": "AJB.L",
        "companyName": "AJ Bell"
      },
      {
        "symbol": "BWY.L",
        "companyName": "Bellway"
      },
      {
        "symbol": "BHMG.L",
        "companyName": "BH Macro"
      },
      {
        "symbol": "BYG.L",
        "companyName": "Big Yellow Group"
      },
      {
        "symbol": "BPCR.L",
        "companyName": "Biopharma Credit"
      },
      {
        "symbol": "BRGE.L",
        "companyName": "BlackRock Greater Europe Investment Trust"
      },
      {
        "symbol": "BRSC.L",
        "companyName": "BlackRock Smaller Companies Trust"
      },
      {
        "symbol": "BRWM.L",
        "companyName": "BlackRock World Mining Trust"
      },
      {
        "symbol": "BMY.L",
        "companyName": "Bloomsbury Publishing"
      },
      {
        "symbol": "BOY.L",
        "companyName": "Bodycote"
      },
      {
        "symbol": "BREE.L",
        "companyName": "Breedon Group"
      },
      {
        "symbol": "BPT.L",
        "companyName": "Bridgepoint Group"
      },
      {
        "symbol": "BUT.L",
        "companyName": "Brunner Investment Trust"
      },
      {
        "symbol": "BYIT.L",
        "companyName": "Bytes Technology Group"
      },
      {
        "symbol": "CLDN.L",
        "companyName": "Caledonia Investments"
      },
      {
        "symbol": "CGT.L",
        "companyName": "Capital Gearing Trust"
      },
      {
        "symbol": "CWR.L",
        "companyName": "Ceres Power"
      },
      {
        "symbol": "CHG.L",
        "companyName": "Chemring Group"
      },
      {
        "symbol": "CSN.L",
        "companyName": "Chesnara"
      },
      {
        "symbol": "CTY.L",
        "companyName": "City of London Investment Trust"
      },
      {
        "symbol": "CKN.L",
        "companyName": "Clarkson"
      },
      {
        "symbol": "CMCX.L",
        "companyName": "CMC Markets"
      },
      {
        "symbol": "CORD.L",
        "companyName": "Cordiant Digital Infrastructure"
      },
      {
        "symbol": "COST.L",
        "companyName": "Costain Group"
      },
      {
        "symbol": "CWK.L",
        "companyName": "Cranswick"
      },
      {
        "symbol": "CURY.L",
        "companyName": "Currys"
      },
      {
        "symbol": "CVSG.L",
        "companyName": "CVS Group"
      },
      {
        "symbol": "DLN.L",
        "companyName": "Derwent London"
      },
      {
        "symbol": "DSCV.L",
        "companyName": "discoverIE"
      },
      {
        "symbol": "DOM.L",
        "companyName": "Domino's Pizza"
      },
      {
        "symbol": "DRX.L",
        "companyName": "Drax Group"
      },
      {
        "symbol": "DOCS.L",
        "companyName": "Dr. Martens"
      },
      {
        "symbol": "DNLM.L",
        "companyName": "Dunelm Group"
      },
      {
        "symbol": "EDIN.L",
        "companyName": "Edinburgh Investment Trust"
      },
      {
        "symbol": "EWI.L",
        "companyName": "Edinburgh Worldwide Investment Trust"
      },
      {
        "symbol": "ELM.L",
        "companyName": "Elementis"
      },
      {
        "symbol": "ENOG.L",
        "companyName": "Energean"
      },
      {
        "symbol": "ESCT.L",
        "companyName": "European Smaller Companies Trust"
      },
      {
        "symbol": "EWG.L",
        "companyName": "Eurowag"
      },
      {
        "symbol": "FCSS.L",
        "companyName": "Fidelity China Special Situations"
      },
      {
        "symbol": "FEML.L",
        "companyName": "Fidelity Emerging Markets"
      },
      {
        "symbol": "FEV.L",
        "companyName": "Fidelity European Trust"
      },
      {
        "symbol": "FSV.L",
        "companyName": "Fidelity Special Values"
      },
      {
        "symbol": "FGT.L",
        "companyName": "Finsbury Growth & Income Trust"
      },
      {
        "symbol": "FGP.L",
        "companyName": "FirstGroup"
      },
      {
        "symbol": "FGEN.L",
        "companyName": "Foresight Environmental Infrastructure"
      },
      {
        "symbol": "FSG.L",
        "companyName": "Foresight Group"
      },
      {
        "symbol": "FCH.L",
        "companyName": "Funding Circle"
      },
      {
        "symbol": "GFRD.L",
        "companyName": "Galliford Try"
      },
      {
        "symbol": "GAMA.L",
        "companyName": "Gamma Communications"
      },
      {
        "symbol": "GBG.L",
        "companyName": "GB Group"
      },
      {
        "symbol": "GCP.L",
        "companyName": "GCP Infrastructure Investments"
      },
      {
        "symbol": "GEN.L",
        "companyName": "Genuit Group"
      },
      {
        "symbol": "GNS.L",
        "companyName": "Genus"
      },
      {
        "symbol": "DATA.L",
        "companyName": "GlobalData"
      },
      {
        "symbol": "GSCT.L",
        "companyName": "Global Smaller Companies Trust"
      },
      {
        "symbol": "GDWN.L",
        "companyName": "Goodwin"
      },
      {
        "symbol": "GFTU.L",
        "companyName": "Grafton Group"
      },
      {
        "symbol": "GRI.L",
        "companyName": "Grainger"
      },
      {
        "symbol": "GPE.L",
        "companyName": "Great Portland Estates"
      },
      {
        "symbol": "UKW.L",
        "companyName": "Greencoat UK Wind"
      },
      {
        "symbol": "GNC.L",
        "companyName": "Greencore"
      },
      {
        "symbol": "HFD.L",
        "companyName": "Halfords"
      },
      {
        "symbol": "HMSO.L",
        "companyName": "Hammerson"
      },
      {
        "symbol": "HANA.L",
        "companyName": "Hansa Investment Company"
      },
      {
        "symbol": "HVPE.L",
        "companyName": "HarbourVest Global Private Equity"
      },
      {
        "symbol": "HWG.L",
        "companyName": "Harworth Group"
      },
      {
        "symbol": "HAS.L",
        "companyName": "Hays"
      },
      {
        "symbol": "HTWS.L",
        "companyName": "Helios Towers"
      },
      {
        "symbol": "HFEL.L",
        "companyName": "Henderson Far East Income"
      },
      {
        "symbol": "HSL.L",
        "companyName": "Henderson Smaller Companies Investment Trust"
      },
      {
        "symbol": "HRI.L",
        "companyName": "Herald Investment Trust"
      },
      {
        "symbol": "HGT.L",
        "companyName": "Hg Capital Trust"
      },
      {
        "symbol": "HICL.L",
        "companyName": "HICL Infrastructure Company"
      },
      {
        "symbol": "HILS.L",
        "companyName": "Hill & Smith"
      },
      {
        "symbol": "HFG.L",
        "companyName": "Hilton Food Group"
      },
      {
        "symbol": "HOC.L",
        "companyName": "Hochschild Mining"
      },
      {
        "symbol": "BOWL.L",
        "companyName": "Hollywood Bowl Group"
      },
      {
        "symbol": "HTG.L",
        "companyName": "Hunting"
      },
      {
        "symbol": "ICGT.L",
        "companyName": "ICG Enterprise Trust"
      },
      {
        "symbol": "INCH.L",
        "companyName": "Inchcape"
      },
      {
        "symbol": "IHP.L",
        "companyName": "IntegraFin Holdings"
      },
      {
        "symbol": "INPP.L",
        "companyName": "International Public Partnerships"
      },
      {
        "symbol": "IWG.L",
        "companyName": "International Workplace Group"
      },
      {
        "symbol": "IAD.L",
        "companyName": "Invesco Asia Dragon Trust"
      },
      {
        "symbol": "IPO.L",
        "companyName": "IP Group"
      },
      {
        "symbol": "ITH.L",
        "companyName": "Ithaca Energy"
      },
      {
        "symbol": "JSG.L",
        "companyName": "Johnson Service Group"
      },
      {
        "symbol": "JAM.L",
        "companyName": "JPMorgan American Investment Trust"
      },
      {
        "symbol": "JCH.L",
        "companyName": "JPMorgan Claverhouse Investment Trust"
      },
      {
        "symbol": "JEMI.L",
        "companyName": "JPMorgan Emerging Markets Dividend Income"
      },
      {
        "symbol": "JMGI.L",
        "companyName": "JPMorgan Emerging Markets Growth & Income"
      },
      {
        "symbol": "JEDT.L",
        "companyName": "JPMorgan European Discovery"
      },
      {
        "symbol": "JEGI.L",
        "companyName": "JPMorgan European Growth & Income"
      },
      {
        "symbol": "JGGI.L",
        "companyName": "JPMorgan Global Growth & Income"
      },
      {
        "symbol": "JFJ.L",
        "companyName": "JPMorgan Japanese Investment Trust"
      },
      {
        "symbol": "JTC.L",
        "companyName": "JTC"
      },
      {
        "symbol": "JUP.L",
        "companyName": "Jupiter Fund Management"
      },
      {
        "symbol": "KNOS.L",
        "companyName": "Kainos"
      },
      {
        "symbol": "KLR.L",
        "companyName": "Keller Group"
      },
      {
        "symbol": "KIE.L",
        "companyName": "Kier Group"
      },
      {
        "symbol": "LRE.L",
        "companyName": "Lancashire Holdings"
      },
      {
        "symbol": "LWDB.L",
        "companyName": "Law Debenture"
      },
      {
        "symbol": "EMG.L",
        "companyName": "Man Group"
      },
      {
        "symbol": "MEGP.L",
        "companyName": "ME Group International"
      },
      {
        "symbol": "MRC.L",
        "companyName": "Mercantile Investment Trust"
      },
      {
        "symbol": "MRCH.L",
        "companyName": "Merchants Trust"
      },
      {
        "symbol": "MTRO.L",
        "companyName": "Metro Bank"
      },
      {
        "symbol": "MAB.L",
        "companyName": "Mitchells & Butlers"
      },
      {
        "symbol": "MTO.L",
        "companyName": "Mitie"
      },
      {
        "symbol": "GROW.L",
        "companyName": "Molten Ventures"
      },
      {
        "symbol": "MNKS.L",
        "companyName": "Monks Investment Trust"
      },
      {
        "symbol": "MONY.L",
        "companyName": "MONY Group"
      },
      {
        "symbol": "MOON.L",
        "companyName": "Moonpig"
      },
      {
        "symbol": "MGAM.L",
        "companyName": "Morgan Advanced Materials"
      },
      {
        "symbol": "MGNS.L",
        "companyName": "Morgan Sindall Group"
      },
      {
        "symbol": "MUT.L",
        "companyName": "Murray Income Trust"
      },
      {
        "symbol": "MYI.L",
        "companyName": "Murray International Trust"
      },
      {
        "symbol": "NBPE.L",
        "companyName": "NB Private Equity Partners"
      },
      {
        "symbol": "NCC.L",
        "companyName": "NCC Group"
      },
      {
        "symbol": "N91.L",
        "companyName": "Ninety One"
      },
      {
        "symbol": "NAS.L",
        "companyName": "North Atlantic Smaller Companies Investment Trust"
      },
      {
        "symbol": "OCI.L",
        "companyName": "Oakley Capital Investments"
      },
      {
        "symbol": "OSB.L",
        "companyName": "OSB Group"
      },
      {
        "symbol": "OXB.L",
        "companyName": "Oxford Biomedica"
      },
      {
        "symbol": "OXIG.L",
        "companyName": "Oxford Instruments"
      },
      {
        "symbol": "ONT.L",
        "companyName": "Oxford Nanopore Technologies"
      },
      {
        "symbol": "PHI.L",
        "companyName": "Pacific Horizon Investment Trust"
      },
      {
        "symbol": "PAGE.L",
        "companyName": "PageGroup"
      },
      {
        "symbol": "PAF.L",
        "companyName": "Pan African Resources"
      },
      {
        "symbol": "PINT.L",
        "companyName": "Pantheon Infrastructure"
      },
      {
        "symbol": "PIN.L",
        "companyName": "Pantheon International"
      },
      {
        "symbol": "PAG.L",
        "companyName": "Paragon Banking Group"
      },
      {
        "symbol": "PEY.L",
        "companyName": "Partners Group Private Equity"
      },
      {
        "symbol": "PPET.L",
        "companyName": "Patria Private Equity Trust"
      },
      {
        "symbol": "PNL.L",
        "companyName": "Personal Assets Trust"
      },
      {
        "symbol": "PETS.L",
        "companyName": "Pets at Home"
      },
      {
        "symbol": "PTEC.L",
        "companyName": "Playtech"
      },
      {
        "symbol": "PLUS.L",
        "companyName": "Plus500"
      },
      {
        "symbol": "PCGH.L",
        "companyName": "Polar Capital Global Healthcare Trust"
      },
      {
        "symbol": "POLN.L",
        "companyName": "Pollen Street Group"
      },
      {
        "symbol": "PPH.L",
        "companyName": "PPHE Hotel Group"
      },
      {
        "symbol": "PFD.L",
        "companyName": "Premier Foods"
      },
      {
        "symbol": "PHP.L",
        "companyName": "Primary Health Properties"
      },
      {
        "symbol": "PRN.L",
        "companyName": "Princes Group"
      },
      {
        "symbol": "QLT.L",
        "companyName": "Quilter"
      },
      {
        "symbol": "RNK.L",
        "companyName": "Rank Group"
      },
      {
        "symbol": "RPI.L",
        "companyName": "Raspberry Pi Holdings"
      },
      {
        "symbol": "RAT.L",
        "companyName": "Rathbones"
      },
      {
        "symbol": "RSW.L",
        "companyName": "Renishaw"
      },
      {
        "symbol": "RHIM.L",
        "companyName": "RHI Magnesita"
      },
      {
        "symbol": "RCP.L",
        "companyName": "RIT Capital Partners"
      },
      {
        "symbol": "ROSE.L",
        "companyName": "Rosebank Industries"
      },
      {
        "symbol": "ROR.L",
        "companyName": "Rotork"
      },
      {
        "symbol": "RTW.L",
        "companyName": "RTW Biotech Opportunities"
      },
      {
        "symbol": "RICA.L",
        "companyName": "Ruffer Investment Company"
      },
      {
        "symbol": "SAFE.L",
        "companyName": "Safestore"
      },
      {
        "symbol": "SAGA.L",
        "companyName": "Saga"
      },
      {
        "symbol": "SVS.L",
        "companyName": "Savills"
      },
      {
        "symbol": "MNTN.L",
        "companyName": "Schiehallion Fund"
      },
      {
        "symbol": "ATR.L",
        "companyName": "Schroder Asian Total Return Investment Company"
      },
      {
        "symbol": "SDP.L",
        "companyName": "Schroder AsiaPacific Fund"
      },
      {
        "symbol": "SOI.L",
        "companyName": "Schroder Oriental Income Fund"
      },
      {
        "symbol": "SAIN.L",
        "companyName": "Scottish American Investment Company"
      },
      {
        "symbol": "SEIT.L",
        "companyName": "SDCL Efficiency Income Trust"
      },
      {
        "symbol": "SNR.L",
        "companyName": "Senior"
      },
      {
        "symbol": "SEQI.L",
        "companyName": "Sequoia Economic Infrastructure Income Fund"
      },
      {
        "symbol": "SSIT.L",
        "companyName": "Seraphim Space Investment Trust"
      },
      {
        "symbol": "SRP.L",
        "companyName": "Serco"
      },
      {
        "symbol": "SHC.L",
        "companyName": "Shaftesbury Capital"
      },
      {
        "symbol": "SHAW.L",
        "companyName": "Shawbrook Bank"
      },
      {
        "symbol": "SRE.L",
        "companyName": "Sirius Real Estate"
      },
      {
        "symbol": "SCT.L",
        "companyName": "Softcat"
      },
      {
        "symbol": "SPI.L",
        "companyName": "Spire Healthcare"
      },
      {
        "symbol": "SSPG.L",
        "companyName": "SSP Group"
      },
      {
        "symbol": "SUPR.L",
        "companyName": "Supermarket Income REIT"
      },
      {
        "symbol": "SYNC.L",
        "companyName": "Syncona"
      },
      {
        "symbol": "THRL.L",
        "companyName": "Target Healthcare REIT"
      },
      {
        "symbol": "TBCG.L",
        "companyName": "TBC Bank"
      },
      {
        "symbol": "TEP.L",
        "companyName": "Telecom Plus"
      },
      {
        "symbol": "TMPL.L",
        "companyName": "Temple Bar Investment Trust"
      },
      {
        "symbol": "TEM.L",
        "companyName": "Templeton Emerging Markets Investment Trust"
      },
      {
        "symbol": "TRIG.L",
        "companyName": "The Renewables Infrastructure Group"
      },
      {
        "symbol": "TCAP.L",
        "companyName": "TP ICAP"
      },
      {
        "symbol": "TRN.L",
        "companyName": "Trainline"
      },
      {
        "symbol": "TPK.L",
        "companyName": "Travis Perkins"
      },
      {
        "symbol": "TRY.L",
        "companyName": "TR Property Investment Trust"
      },
      {
        "symbol": "TRST.L",
        "companyName": "Trustpilot"
      },
      {
        "symbol": "TFIF.L",
        "companyName": "Twentyfour Income Fund"
      },
      {
        "symbol": "UEM.L",
        "companyName": "Utilico Emerging Markets"
      },
      {
        "symbol": "VSVS.L",
        "companyName": "Vesuvius"
      },
      {
        "symbol": "VCT.L",
        "companyName": "Victrex"
      },
      {
        "symbol": "VEIL.L",
        "companyName": "Vietnam Enterprise Investments"
      },
      {
        "symbol": "VOF.L",
        "companyName": "VinaCapital Vietnam Opportunity Fund"
      },
      {
        "symbol": "FAN.L",
        "companyName": "Volution Group"
      },
      {
        "symbol": "WOSG.L",
        "companyName": "Watches of Switzerland"
      },
      {
        "symbol": "JDW.L",
        "companyName": "Wetherspoons"
      },
      {
        "symbol": "SMWH.L",
        "companyName": "WHSmith"
      },
      {
        "symbol": "WIX.L",
        "companyName": "Wickes"
      },
      {
        "symbol": "WKP.L",
        "companyName": "Workspace Group"
      },
      {
        "symbol": "WWH.L",
        "companyName": "Worldwide Healthcare Trust"
      },
      {
        "symbol": "XPP.L",
        "companyName": "XP Power"
      },
      {
        "symbol": "XPS.L",
        "companyName": "XPS Pensions"
      },
      {
        "symbol": "ZIG.L",
        "companyName": "Zigup"
      }
    ]
  }
];

// Auto-detected new listings (buildNewListings.ts, weekly via pit-snapshot.yml).
// The data lives in src/autoListings.json so CI only ever commits JSON, never a .ts
// file. Absent or malformed file = clean no-op. These symbols have no enrichment, so
// every row they produce is unreliable_reason='null_enrichment' -> quarantined from
// pots/notifications/rankings until expansionReadout.ts clears the cohort.
try {
  const autoPath = path.join(process.cwd(), 'src', 'autoListings.json');
  if (fs.existsSync(autoPath)) {
    const auto = JSON.parse(fs.readFileSync(autoPath, 'utf8')) as Market;
    if (auto?.name && Array.isArray(auto.stocks) && auto.stocks.length) {
      GLOBAL_MARKETS.push({ name: auto.name, stocks: auto.stocks });
    }
  }
} catch (err) {
  console.warn('[marketsData] autoListings.json unreadable, continuing without it:', (err as Error).message);
}
