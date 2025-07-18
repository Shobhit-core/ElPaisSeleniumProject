package com.elpais.base;

import com.elpais.config.ConfigReader;
import com.elpais.utils.driverManager;
import org.openqa.selenium.WebDriver;
import org.testng.annotations.BeforeClass;
import org.testng.annotations.Optional;
import org.testng.annotations.Parameters;
import org.testng.annotations.AfterClass;

public class BaseTest {
    protected WebDriver driver;

    @BeforeClass
    @Parameters("browser")
    public void setUp(@Optional("") String browser) throws Exception {
        ConfigReader.load("config.properties");

        if (browser == null || browser.isEmpty()) {
            browser = ConfigReader.get("browser");  // fallback to local config
        }

        driver = WebDriverFactory.getDriver(browser);
        driverManager.setDriver(driver);
        driver.manage().window().maximize();
        driver.get(ConfigReader.get("baseUrl"));
    }

    @AfterClass
    public void tearDown() {
        driverManager.quitDriver();
    }
}
