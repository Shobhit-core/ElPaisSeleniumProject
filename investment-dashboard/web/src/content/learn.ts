// Educational content. Principles are summarised from these investors' widely published books,
// letters and interviews (titles listed); no quotes or performance figures are invented.
// "Evidence" links each philosophy to the closest NSE strategy index tested on the Learn page.

export interface Philosophy {
  id: string;
  name: string;
  known: string;
  sources: string;
  principles: string[];
  suits: string;
  strengths: string[];
  weaknesses: string[];
  failure: string;
  forYou: string;
  evidenceIndex: string | null;
}

export const PHILOSOPHIES: Philosophy[] = [
  {
    id: "bogle", name: "John Bogle", known: "Founder of Vanguard; pioneer of low-cost index funds",
    sources: "Common Sense on Mutual Funds; The Little Book of Common Sense Investing",
    principles: ["Costs compound against you — minimise fees, taxes and turnover.", "Most active managers fail to beat the index after costs over long periods.", "Own the whole market, hold for decades, stay the course.", "Asset allocation matters more than security selection."],
    suits: "Almost everyone, in every market condition; especially beginners and busy professionals.",
    strengths: ["Very low cost and effort", "No single-company or manager risk", "Behaviourally easy: nothing to tinker with"],
    weaknesses: ["You get the market's return — never more", "Fully exposed to market crashes", "Index can become concentrated in expensive sectors"],
    failure: "Selling in a crash. The strategy only works if you hold through 30–60% falls.",
    forYou: "This is your core: the Nifty 50 index fund and monthly SIPs. Your active stock picks must beat this after costs — the Performance page checks that.",
    evidenceIndex: "Nifty 50",
  },
  {
    id: "graham", name: "Benjamin Graham", known: "Father of value investing; Buffett's teacher",
    sources: "The Intelligent Investor; Security Analysis",
    principles: ["A share is part-ownership of a business, not a ticker.", "Margin of safety: buy well below a conservative estimate of value.", "'Mr. Market' offers prices daily — use his mood, don't follow it.", "Distinguish investment (analysis, safety of principal) from speculation."],
    suits: "Fearful, falling or neglected markets; investors with patience and a valuation discipline.",
    strengths: ["Built-in protection against estimation errors", "Forces discipline on price", "Works well after crashes"],
    weaknesses: ["Cheap stocks can stay cheap or get cheaper ('value traps')", "Underweights high-quality compounders", "Can lag badly for years in growth-led markets"],
    failure: "Buying a declining business because it looks statistically cheap.",
    forYou: "The committee requires a 25% margin of safety and the Graham number is one of the valuation methods. Use it as a price discipline, not a stock screen on its own.",
    evidenceIndex: "Nifty50 Value 20",
  },
  {
    id: "buffett", name: "Warren Buffett", known: "Chairman of Berkshire Hathaway",
    sources: "Berkshire Hathaway shareholder letters (1965 onward); interviews",
    principles: ["Buy wonderful businesses at fair prices rather than fair businesses at wonderful prices.", "Durable competitive advantage ('moat'), honest and able management.", "Stay within your circle of competence.", "Hold for very long periods; let compounding work; avoid leverage."],
    suits: "Long horizons; investors who can analyse businesses and tolerate concentration and long waits.",
    strengths: ["Focus on quality reduces permanent loss", "Low turnover and tax efficiency", "Clear, testable thesis per business"],
    weaknesses: ["Requires deep research and judgement", "Quality is often already priced in", "His scale, access and permanent capital cannot be replicated"],
    failure: "Paying any price for 'quality', or misjudging a moat that technology disrupts.",
    forYou: "The fundamental score's profitability and balance-sheet pillars and the 'moat' question in your thesis come from here. With ₹30,000, the index fund already owns most of India's large quality businesses.",
    evidenceIndex: "NIFTY100 Quality 30",
  },
  {
    id: "munger", name: "Charlie Munger", known: "Buffett's partner; multidisciplinary thinker",
    sources: "Poor Charlie's Almanack; Berkshire and Daily Journal meetings",
    principles: ["Use a latticework of mental models from many disciplines.", "Invert: ask how an investment could fail before asking how it could succeed.", "Avoid stupidity rather than seeking brilliance.", "Sit on your hands — few, large, well-understood decisions."],
    suits: "Any market; most useful for avoiding errors.",
    strengths: ["Strong defence against behavioural mistakes", "Encourages patience"],
    weaknesses: ["Hard to apply mechanically", "Concentration increases single-decision risk"],
    failure: "Overconfidence that you understand a business when you don't.",
    forYou: "The skeptical reviewer on the Investment Committee and the 'invalidation conditions' field are inversion in practice.",
    evidenceIndex: null,
  },
  {
    id: "lynch", name: "Peter Lynch", known: "Managed Fidelity Magellan 1977–1990",
    sources: "One Up on Wall Street; Beating the Street",
    principles: ["Invest in what you understand — your everyday knowledge can be an edge.", "Know why you own each stock in two minutes.", "Classify companies (slow growers, stalwarts, fast growers, cyclicals, turnarounds, asset plays).", "PEG ratio: growth matters relative to price."],
    suits: "Growing economies with many expanding mid-sized companies — relevant to India.",
    strengths: ["Practical, accessible research approach", "Captures growth"],
    weaknesses: ["'Buy what you know' is misread as 'buy what you like'", "Fast growers are volatile and often expensive", "He did intensive, full-time research"],
    failure: "Buying popular consumer brands without checking valuation or balance sheet.",
    forYou: "PEG is in the valuation summary; the growth investor on the committee follows Lynch. Write the 'two-minute story' as your thesis.",
    evidenceIndex: "Nifty Midcap 150",
  },
  {
    id: "marks", name: "Howard Marks", known: "Co-founder of Oaktree Capital",
    sources: "The Most Important Thing; Mastering the Market Cycle; Oaktree memos",
    principles: ["Risk means the probability of permanent loss, not volatility.", "Second-level thinking: what is priced in, and what does the crowd miss?", "Know where we are in the cycle — be cautious when others are euphoric.", "Avoiding losers matters more than chasing winners."],
    suits: "Late-cycle, euphoric or panicked markets; credit and debt investing.",
    strengths: ["Excellent risk framework", "Prevents buying at euphoric peaks"],
    weaknesses: ["Cycle-reading is imprecise; can make you too cautious for too long"],
    failure: "Turning cycle awareness into market timing and sitting in cash for years.",
    forYou: "The stress tests, drawdown monitor and valuation-risk entry (market P/E vs median) apply Marks' thinking. Use it to size and stage, never to stop investing.",
    evidenceIndex: null,
  },
  {
    id: "fisher", name: "Philip Fisher", known: "Growth-investing pioneer",
    sources: "Common Stocks and Uncommon Profits",
    principles: ["Research qualitatively through 'scuttlebutt' — customers, suppliers, competitors.", "15 points: long growth runway, R&D, margins, management integrity.", "Buy outstanding companies and rarely sell.", "Concentrate in a few businesses you know deeply."],
    suits: "Long horizons; businesses with long reinvestment runways.",
    strengths: ["Captures long-term compounders", "Emphasises management quality"],
    weaknesses: ["Qualitative judgements are hard to verify", "Concentration risk"],
    failure: "Holding a former great company long after its edge has gone.",
    forYou: "Growth drivers, management and governance fields in your research note and the six-monthly holding review come from Fisher.",
    evidenceIndex: "NIFTY100 Quality 30",
  },
  {
    id: "rj", name: "Rakesh Jhunjhunwala", known: "Indian investor and trader (1960–2022)",
    sources: "Public interviews and speeches; documented long-term holdings disclosed in shareholding filings",
    principles: ["Long-term optimism about India's economic growth.", "Conviction: hold strong businesses through volatility.", "Respect the market; accept losses and move on.", "Combine fundamental investing with an understanding of market sentiment."],
    suits: "Strong domestic growth phases; investors with high risk tolerance and deep market knowledge.",
    strengths: ["Captures India's long growth story", "Conviction prevents panic selling"],
    weaknesses: ["Concentrated positions and leverage magnify losses", "Survivorship bias: famous winners hide many losers", "His trading activity and access are not replicable"],
    failure: "Copying a famous investor's stock list without his research, sizing or risk capacity.",
    forYou: "Share the long-term optimism and the discipline to hold, but not the concentration or trading. The dashboard caps single stocks at 20% and forbids leverage.",
    evidenceIndex: "Nifty Smallcap 250",
  },
  {
    id: "nshah", name: "Nilesh Shah", known: "Managing Director, Kotak Mahindra AMC; frequent commentator on Indian asset allocation",
    sources: "Public interviews, AMC commentary and columns",
    principles: ["Asset allocation tailored to the investor's goal and horizon.", "SIPs and staying invested through cycles.", "Valuation-aware allocation across equity, debt and gold.", "Avoid herd behaviour and leverage."],
    suits: "Retail investors building wealth through mutual funds across cycles.",
    strengths: ["Practical for Indian investors", "Balances growth and stability"],
    weaknesses: ["Allocation views are general, not personal advice", "Commentary from a fund-house executive may reflect that context"],
    failure: "Treating any commentator's market view as a personal instruction.",
    forYou: "Your plan (equity/debt/gold mix, SIPs, staging) follows this asset-allocation approach.",
    evidenceIndex: null,
  },
];

export interface CaseStudy {
  title: string;
  when: string;
  kind: "Crash" | "Failure" | "Success";
  what: string;
  lessons: string[];
}

// Figures are approximate and widely reported; verify specifics before relying on them.
export const CASES: CaseStudy[] = [
  { title: "Harshad Mehta securities scam", when: "1992", kind: "Crash", what: "A bull run fuelled by misuse of bank funds collapsed when exposed; the Sensex fell by roughly half over the following year (approximate).", lessons: ["Prices driven by manipulation, not earnings, eventually collapse.", "Regulation (SEBI's powers) was strengthened afterwards."] },
  { title: "Dot-com bust", when: "2000–2001", kind: "Crash", what: "Technology stocks worldwide collapsed; Indian IT and media stocks fell very sharply from 2000 peaks.", lessons: ["A great theme does not make every stock a great investment.", "Valuation matters even for real growth stories."] },
  { title: "Global financial crisis", when: "2008", kind: "Crash", what: "Indian shares fell roughly 60% from the January 2008 peak to the October 2008 low (approximate) and took about two to three years to regain the peak.", lessons: ["Diversified investors who kept investing recovered; leveraged investors were wiped out.", "Have an emergency fund so you never have to sell in a crash."] },
  { title: "Satyam accounting fraud", when: "January 2009", kind: "Failure", what: "The chairman admitted inflating cash and profits; the share price collapsed by most of its value within days.", lessons: ["Verify cash flow, not just reported profit.", "Governance red flags (unusual related-party deals) deserve heavy weight.", "Never let one stock be a large share of your portfolio."] },
  { title: "IL&FS default", when: "2018", kind: "Failure", what: "A large infrastructure lender defaulted; debt mutual funds holding its paper saw sudden NAV drops.", lessons: ["Debt funds are not risk-free — check credit quality.", "Prefer funds holding mostly government and AAA paper."] },
  { title: "Yes Bank collapse", when: "2018–2020", kind: "Failure", what: "A once-popular bank stock fell over 90% from its peak amid bad loans and governance issues before an RBI-led rescue.", lessons: ["Past popularity is not evidence of safety.", "Rising bad loans and management turmoil are thesis-breakers."] },
  { title: "COVID crash and recovery", when: "Feb–Nov 2020", kind: "Crash", what: "The Nifty fell roughly 38% in about five weeks (approximate), then recovered to new highs within the year.", lessons: ["Crashes can be fast; recoveries can be fast too — selling locks in losses.", "SIPs during the fall bought units at low prices."] },
  { title: "Franklin Templeton debt-fund wind-up", when: "April 2020", kind: "Failure", what: "Six credit-risk debt schemes were wound up when they could not meet redemptions; investors waited months to be repaid.", lessons: ["Liquidity risk is real in lower-rated debt.", "Your 'safe money' belongs in liquid/short-duration high-quality funds."] },
  { title: "Long-term SIP in a broad index", when: "Any 10+ year period", kind: "Success", what: "Investors who kept a monthly SIP in a broad index through 2008, 2020 and other falls generally ended with positive real returns over long horizons — the simplest strategy outlasted most clever ones.", lessons: ["Time in the market and consistency beat timing.", "The hardest part is behavioural: continuing during falls."] },
  { title: "Quality compounders held for decades", when: "1990s onward", kind: "Success", what: "A handful of Indian companies with durable advantages, high returns on capital and honest management compounded for decades.", lessons: ["Holding great businesses requires sitting through many 30%+ falls.", "Survivorship bias: for each famous winner there were many that faded."] },
];

export interface Topic {
  title: string;
  points: string[];
}

export const TOPICS: Topic[] = [
  { title: "Reading financial statements", points: ["Income statement: revenue, operating margin, net profit — look at 5+ years of trend, not one quarter.", "Balance sheet: debt vs equity, receivables and inventory growing faster than sales is a warning.", "Cash flow: operating cash flow should track profit; persistent gaps can indicate aggressive accounting.", "Free cash flow = operating cash flow − capital expenditure; it funds dividends, buybacks and growth.", "Read the auditor's report and related-party transactions note."] },
  { title: "Valuation methods and their limits", points: ["DCF: present value of future free cash flows — very sensitive to growth and discount rate.", "P/E vs own history and peers — misleading at cyclical peaks.", "P/B — useful for banks and asset-heavy firms; ignores intangibles.", "Dividend discount — only for stable dividend payers.", "Always use more than one method and demand a margin of safety; if methods disagree widely, you don't know the value."] },
  { title: "Risk management", points: ["Size every position so a 50% fall in it costs no more than ~2% of the portfolio.", "Diversify across assets (equity, debt, gold) and within equity.", "Keep 6 months of expenses outside investments.", "Know your maximum tolerable loss and stress-test against it.", "Never use leverage or F&O for long-term goals."] },
  { title: "Indian taxation (FY 2026-27, verify each Budget)", points: ["Listed equity & equity funds: held >12 months → LTCG 12.5% above ₹1.25 lakh/year; ≤12 months → STCG 20%.", "Debt funds bought after 1-Apr-2023: gains taxed at your slab rate.", "Dividends: taxed at your slab rate.", "STT is not deductible; brokerage and charges are part of cost.", "Use the ₹1.25 lakh LTCG exemption each year by harvesting gains where sensible."] },
  { title: "Asset allocation", points: ["Allocation (equity/debt/gold) explains most of a portfolio's ups and downs.", "Equity for goals 5+ years away; debt/liquid for money needed sooner.", "Rebalance when an asset drifts 5+ percentage points from target — this forces 'buy low, sell high'.", "Increase equity only as horizon and tolerance allow, never to chase a target."] },
  { title: "Behavioural finance", points: ["Loss aversion: losses hurt about twice as much as gains please — leads to panic selling.", "Recency bias: assuming the last year will repeat.", "Herding / FOMO: buying what is trending after it has risen.", "Overconfidence: overestimating your stock-picking skill — measure it against the index.", "Disposition effect: selling winners too early, holding losers too long.", "Anchoring: fixating on the price you paid."] },
  { title: "Why ₹100 crore is mainly an income problem", points: ["Compounding needs a large base: returns on ₹30,000 are small in rupees; contributions dominate the first 10–15 years.", "Raising income and investing most of each raise accelerates the goal far more than chasing higher returns.", "Higher returns require higher risk; a single 50% loss needs a 100% gain to recover.", "Business ownership and skills can compound faster than markets, but with real risk of failure — evaluate them like investments."] },
];

export interface Opportunity {
  name: string;
  category: "Active income" | "Business income" | "Asset ownership";
  capital: string;
  skills: string;
  time: string;
  risk: "Low" | "Medium" | "High";
  potential: string;
  note: string;
}

// Earning potential is described qualitatively — enter your own realistic numbers in the income model.
export const OPPORTUNITIES: Opportunity[] = [
  { name: "Grow your main career income", category: "Active income", capital: "Low (courses, certifications)", skills: "Deepen your current expertise; move into higher-value roles (architecture, leadership, specialised domains)", time: "Ongoing", risk: "Low", potential: "Usually the largest and most reliable lever in the first 10–15 years", note: "Negotiate raises; invest at least half of every raise." },
  { name: "Freelance / consulting in your expertise", category: "Active income", capital: "Very low", skills: "Existing professional skills + client communication", time: "5–15 hrs/week alongside a job", risk: "Low", potential: "Meaningful side income once a reputation exists", note: "Check your employment contract for conflicts first." },
  { name: "Technology & automation services (e.g. test automation, AI-assisted workflows)", category: "Active income", capital: "Low", skills: "Automation frameworks (e.g. Selenium, Playwright, REST-assured), cloud, AI tooling", time: "Part-time, can grow", risk: "Medium", potential: "Can scale from freelance work to a small agency", note: "Start with one paying client before investing in a brand." },
  { name: "Software product / micro-SaaS", category: "Business income", capital: "Low–medium", skills: "Product, development, marketing, support", time: "6–24 months before meaningful revenue, often longer", risk: "High", potential: "Wide range — most products earn little; a few compound strongly", note: "Validate demand with paying users before building much." },
  { name: "Equity ownership in a business you build", category: "Asset ownership", capital: "Varies", skills: "Everything above + hiring, finance", time: "Years", risk: "High", potential: "The main route by which most very large fortunes are made — with a high failure rate", note: "Don't quit a job without 12+ months of expenses saved and evidence of traction." },
  { name: "Reinvest business profits into the investment portfolio", category: "Asset ownership", capital: "From profits", skills: "Discipline", time: "Ongoing", risk: "Low", potential: "Turns active income into compounding capital", note: "Treat a fixed % of all side/business income as a mandatory SIP." },
];
