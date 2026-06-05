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
        "symbol": "ADSK",
        "companyName": "Autodesk, Inc."
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
        "symbol": "ANET",
        "companyName": "Arista Networks, Inc."
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
        "symbol": "FI",
        "companyName": "Fiserv, Inc."
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
        "symbol": "K",
        "companyName": "Kellanova"
      },
      {
        "symbol": "KL",
        "companyName": "Kirkland Lake Gold"
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
        "symbol": "PARA",
        "companyName": "Paramount Global"
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
        "symbol": "RCI",
        "companyName": "Rogers Communications Inc."
      },
      {
        "symbol": "RCL",
        "companyName": "Royal Caribbean Group"
      },
      {
        "symbol": "REGN",
        "companyName": "Regeneron Pharmaceuticals"
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
        "symbol": "SPSX12",
        "companyName": "Global Enterprise SP 12"
      },
      {
        "symbol": "SPSX24",
        "companyName": "Global Enterprise SP 24"
      },
      {
        "symbol": "SPSX36",
        "companyName": "Global Enterprise SP 36"
      },
      {
        "symbol": "SPSX48",
        "companyName": "Global Enterprise SP 48"
      },
      {
        "symbol": "SPSX60",
        "companyName": "Global Enterprise SP 60"
      },
      {
        "symbol": "SPSX72",
        "companyName": "Global Enterprise SP 72"
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
        "symbol": "ANSS",
        "companyName": "Ansys, Inc."
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
        "symbol": "SGEN",
        "companyName": "Seagen Inc."
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
        "symbol": "SPLK",
        "companyName": "Splunk Inc."
      },
      {
        "symbol": "SPSX1",
        "companyName": "Global Enterprise SP 1"
      },
      {
        "symbol": "SPSX13",
        "companyName": "Global Enterprise SP 13"
      },
      {
        "symbol": "SPSX25",
        "companyName": "Global Enterprise SP 25"
      },
      {
        "symbol": "SPSX37",
        "companyName": "Global Enterprise SP 37"
      },
      {
        "symbol": "SPSX49",
        "companyName": "Global Enterprise SP 49"
      },
      {
        "symbol": "SPSX61",
        "companyName": "Global Enterprise SP 61"
      },
      {
        "symbol": "SPSX73",
        "companyName": "Global Enterprise SP 73"
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
        "symbol": "WBA",
        "companyName": "Walgreens Boots Alliance"
      },
      {
        "symbol": "WDAY",
        "companyName": "Workday, Inc."
      },
      {
        "symbol": "ZS",
        "companyName": "Zscaler, Inc."
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
      },
      {
        "symbol": "SPSX14",
        "companyName": "Global Enterprise SP 14"
      },
      {
        "symbol": "SPSX2",
        "companyName": "Global Enterprise SP 2"
      },
      {
        "symbol": "SPSX26",
        "companyName": "Global Enterprise SP 26"
      },
      {
        "symbol": "SPSX38",
        "companyName": "Global Enterprise SP 38"
      },
      {
        "symbol": "SPSX50",
        "companyName": "Global Enterprise SP 50"
      },
      {
        "symbol": "SPSX62",
        "companyName": "Global Enterprise SP 62"
      },
      {
        "symbol": "SPSX74",
        "companyName": "Global Enterprise SP 74"
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
        "symbol": "SPSX15",
        "companyName": "Global Enterprise SP 15"
      },
      {
        "symbol": "SPSX27",
        "companyName": "Global Enterprise SP 27"
      },
      {
        "symbol": "SPSX3",
        "companyName": "Global Enterprise SP 3"
      },
      {
        "symbol": "SPSX39",
        "companyName": "Global Enterprise SP 39"
      },
      {
        "symbol": "SPSX51",
        "companyName": "Global Enterprise SP 51"
      },
      {
        "symbol": "SPSX63",
        "companyName": "Global Enterprise SP 63"
      },
      {
        "symbol": "SPSX75",
        "companyName": "Global Enterprise SP 75"
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
        "symbol": "SPSX16",
        "companyName": "Global Enterprise SP 16"
      },
      {
        "symbol": "SPSX28",
        "companyName": "Global Enterprise SP 28"
      },
      {
        "symbol": "SPSX4",
        "companyName": "Global Enterprise SP 4"
      },
      {
        "symbol": "SPSX40",
        "companyName": "Global Enterprise SP 40"
      },
      {
        "symbol": "SPSX52",
        "companyName": "Global Enterprise SP 52"
      },
      {
        "symbol": "SPSX64",
        "companyName": "Global Enterprise SP 64"
      },
      {
        "symbol": "SPSX76",
        "companyName": "Global Enterprise SP 76"
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
      },
      {
        "symbol": "SPSX17",
        "companyName": "Global Enterprise SP 17"
      },
      {
        "symbol": "SPSX29",
        "companyName": "Global Enterprise SP 29"
      },
      {
        "symbol": "SPSX41",
        "companyName": "Global Enterprise SP 41"
      },
      {
        "symbol": "SPSX5",
        "companyName": "Global Enterprise SP 5"
      },
      {
        "symbol": "SPSX53",
        "companyName": "Global Enterprise SP 53"
      },
      {
        "symbol": "SPSX65",
        "companyName": "Global Enterprise SP 65"
      },
      {
        "symbol": "SPSX77",
        "companyName": "Global Enterprise SP 77"
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
        "symbol": "SPSX18",
        "companyName": "Global Enterprise SP 18"
      },
      {
        "symbol": "SPSX30",
        "companyName": "Global Enterprise SP 30"
      },
      {
        "symbol": "SPSX42",
        "companyName": "Global Enterprise SP 42"
      },
      {
        "symbol": "SPSX54",
        "companyName": "Global Enterprise SP 54"
      },
      {
        "symbol": "SPSX6",
        "companyName": "Global Enterprise SP 6"
      },
      {
        "symbol": "SPSX66",
        "companyName": "Global Enterprise SP 66"
      },
      {
        "symbol": "SPSX78",
        "companyName": "Global Enterprise SP 78"
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
        "symbol": "SPSX19",
        "companyName": "Global Enterprise SP 19"
      },
      {
        "symbol": "SPSX31",
        "companyName": "Global Enterprise SP 31"
      },
      {
        "symbol": "SPSX43",
        "companyName": "Global Enterprise SP 43"
      },
      {
        "symbol": "SPSX55",
        "companyName": "Global Enterprise SP 55"
      },
      {
        "symbol": "SPSX67",
        "companyName": "Global Enterprise SP 67"
      },
      {
        "symbol": "SPSX7",
        "companyName": "Global Enterprise SP 7"
      },
      {
        "symbol": "SPSX79",
        "companyName": "Global Enterprise SP 79"
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
        "symbol": "BA.L",
        "companyName": "BAE Systems"
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
        "symbol": "SPSX20",
        "companyName": "Global Enterprise SP 20"
      },
      {
        "symbol": "SPSX32",
        "companyName": "Global Enterprise SP 32"
      },
      {
        "symbol": "SPSX44",
        "companyName": "Global Enterprise SP 44"
      },
      {
        "symbol": "SPSX56",
        "companyName": "Global Enterprise SP 56"
      },
      {
        "symbol": "SPSX68",
        "companyName": "Global Enterprise SP 68"
      },
      {
        "symbol": "SPSX8",
        "companyName": "Global Enterprise SP 8"
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
      },
      {
        "symbol": "SPSX21",
        "companyName": "Global Enterprise SP 21"
      },
      {
        "symbol": "SPSX33",
        "companyName": "Global Enterprise SP 33"
      },
      {
        "symbol": "SPSX45",
        "companyName": "Global Enterprise SP 45"
      },
      {
        "symbol": "SPSX57",
        "companyName": "Global Enterprise SP 57"
      },
      {
        "symbol": "SPSX69",
        "companyName": "Global Enterprise SP 69"
      },
      {
        "symbol": "SPSX9",
        "companyName": "Global Enterprise SP 9"
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
        "symbol": "SPSX10",
        "companyName": "Global Enterprise SP 10"
      },
      {
        "symbol": "SPSX22",
        "companyName": "Global Enterprise SP 22"
      },
      {
        "symbol": "SPSX34",
        "companyName": "Global Enterprise SP 34"
      },
      {
        "symbol": "SPSX46",
        "companyName": "Global Enterprise SP 46"
      },
      {
        "symbol": "SPSX58",
        "companyName": "Global Enterprise SP 58"
      },
      {
        "symbol": "SPSX70",
        "companyName": "Global Enterprise SP 70"
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
        "symbol": "SPSX11",
        "companyName": "Global Enterprise SP 11"
      },
      {
        "symbol": "SPSX23",
        "companyName": "Global Enterprise SP 23"
      },
      {
        "symbol": "SPSX35",
        "companyName": "Global Enterprise SP 35"
      },
      {
        "symbol": "SPSX47",
        "companyName": "Global Enterprise SP 47"
      },
      {
        "symbol": "SPSX59",
        "companyName": "Global Enterprise SP 59"
      },
      {
        "symbol": "SPSX71",
        "companyName": "Global Enterprise SP 71"
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
      }
    ]
  }
];
