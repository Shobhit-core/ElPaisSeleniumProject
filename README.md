# ElPaisSeleniumProject 📰

Automated Selenium test framework for scraping and validating top headlines from the Spanish news site [El País](https://elpais.com), with translation and cross-browser testing support via BrowserStack.

---

## 🌐 Features

- ✅ **Web scraping**: Extracts top article headlines from the “Opinion” section
- 🌍 **Translation API**: Translates Spanish headlines to English using RapidAPI
- 📸 **Image downloader**: Downloads and stores article thumbnails (if available)
- ☁️ **BrowserStack integration**: Supports testing across 5 different device/browser combinations
- 🔄 **Local & Remote Execution**: Run locally or scale tests via BrowserStack
- 🧪 **TestNG + Page Object Model**: Robust structure for test reusability and scalability

---

## 📁 Project Structure

ElPaisSeleniumProject/
├── base/ # Base test setup and WebDriver factory
├── config/ # ConfigReader to load property files
├── pages/ # Page Object classes (HomePage, OpinionPage)
├── runner/ # TestNG runner classes for local & BrowserStack
├── utils/ # Utility classes: WaitUtils, Translator, ImageDownloader
├── resources/
│ └── config.properties # Central config (URL, BrowserStack creds, device setup)
└── testng.xml # TestNG suite file
---

## ⚙️ Configuration
`config.properties` file:

```properties
baseUrl=https://elpais.com
articleCount=5
sourceLang=es
targetLang=en

browser=chrome  # or firefox / bs1 / bs2 / bs3 / bs4 / bs5

# BrowserStack credentials
browserstack.user=YOUR_USERNAME
browserstack.key=YOUR_ACCESS_KEY
You can configure up to 5 parallel BrowserStack setups (desktop and mobile) by changing browser to bs1, bs2, etc.

🚀 How to Run
🔧 Local
mvn clean test -Dbrowser=chrome
☁️ BrowserStack
mvn clean test -Dbrowser=bs1
Or use the BrowserStackRunner.java to test each device individually.

📸 Debugging Failed BrowserStack Tests
After test execution, the console will print the session URL:

Session Debug URL: https://automate.browserstack.com/sessions/<session-id>
Open the URL in your browser to watch a live video recording of the failed session, inspect logs, and debug.

📦 Dependencies
Java 11+

Maven

Selenium WebDriver

TestNG

Gson (for JSON parsing)

Apache Commons IO

BrowserStack RemoteWebDriver

🤝 Contributing
Pull requests are welcome. For major changes, open an issue first to discuss what you’d like to change.

🙋‍♂️ Author
Shobhit Budhlakoti
📧 https://www.linkedin.com/in/shobhit-budhlakoti-34492b161/
