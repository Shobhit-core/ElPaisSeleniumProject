package com.elpais.base;

import com.elpais.config.ConfigReader;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.chrome.ChromeDriver;
import org.openqa.selenium.firefox.FirefoxDriver;
import org.openqa.selenium.remote.RemoteWebDriver;
import org.openqa.selenium.MutableCapabilities;

import java.net.URL;

public class WebDriverFactory {

    public static WebDriver getDriver(String browserKey) throws Exception {
        if (browserKey.toLowerCase().startsWith("bs")) {
            return createBrowserStackDriver(browserKey);
        }

        switch (browserKey.toLowerCase()) {
            case "chrome":
                return new ChromeDriver();
            case "firefox":
                return new FirefoxDriver();
            default:
                throw new RuntimeException("Unsupported browser config: " + browserKey);
        }
    }

    private static WebDriver createBrowserStackDriver(String key) throws Exception {
        MutableCapabilities capabilities = new MutableCapabilities();
        MutableCapabilities bstackOptions = new MutableCapabilities();

        String user = ConfigReader.get("browserstack.user");
        String pass = ConfigReader.get("browserstack.key");

        if (ConfigReader.get(key + ".device") != null) {
            // Mobile configuration
            capabilities.setCapability("browserName", ConfigReader.get(key + ".browser"));
            bstackOptions.setCapability("deviceName", ConfigReader.get(key + ".device"));
            bstackOptions.setCapability("realMobile", ConfigReader.get(key + ".real_mobile"));
            bstackOptions.setCapability("osVersion", ConfigReader.get(key + ".os_version"));
        } else {
            // Desktop configuration
            capabilities.setCapability("browserName", ConfigReader.get(key + ".browser"));
            capabilities.setCapability("browserVersion", ConfigReader.get(key + ".browser_version"));
            bstackOptions.setCapability("os", ConfigReader.get(key + ".os"));
            bstackOptions.setCapability("osVersion", ConfigReader.get(key + ".os_version"));
        }

        // Common to all BrowserStack tests
        bstackOptions.setCapability("projectName", "ElPaisAutomation");
        bstackOptions.setCapability("buildName", "ElPais-BrowserStack-Build");
        bstackOptions.setCapability("sessionName", "ElPais Test - " + key);


        // Final bundling of options
        capabilities.setCapability("bstack:options", bstackOptions);

        String url = "https://" + user + ":" + pass + "@hub.browserstack.com/wd/hub";
        return new RemoteWebDriver(new URL(url), capabilities);
    }
}
