package com.elpais.utils;
import org.openqa.selenium.*;
import org.openqa.selenium.support.ui.*;
import java.time.Duration;

public class WaitUtils {

    public static WebElement waitForElementVisible(WebElement element, int timeoutInSeconds) {
        WebDriver driver = driverManager.getDriver();
        WebDriverWait wait = new WebDriverWait(driver, Duration.ofSeconds(timeoutInSeconds));
        return wait.until(ExpectedConditions.visibilityOf(element));
    }

    public static WebElement fluentWait(WebElement element, int timeoutInSeconds, int pollingInMillis) {
        WebDriver driver = driverManager.getDriver();
        FluentWait<WebDriver> wait = new FluentWait<>(driver)
                .withTimeout(Duration.ofSeconds(timeoutInSeconds))
                .pollingEvery(Duration.ofMillis(pollingInMillis))
                .ignoring(NoSuchElementException.class)
                .ignoring(StaleElementReferenceException.class);

        return wait.until(d -> {
            if (element.isDisplayed()) {
                return element;
            }
            return null;
        });
    }
}
