package com.elpais.utils;

import org.apache.commons.io.FileUtils;
import org.openqa.selenium.OutputType;
import org.openqa.selenium.TakesScreenshot;
import org.openqa.selenium.WebDriver;

import java.io.File;

public class driverManager {
    private static final ThreadLocal<WebDriver> driverThread = new ThreadLocal<>();

    public static WebDriver getDriver() {
        return driverThread.get();
    }

    public static void setDriver(WebDriver driver) {
        driverThread.set(driver);
    }

    public static void quitDriver() {
        WebDriver driver = getDriver();
        if (driver != null) {
            driver.quit();
            driverThread.remove();
        }
    }

    public static void takeScreenshot(String testName, WebDriver driver) {
        File src = ((TakesScreenshot) driver).getScreenshotAs(OutputType.FILE);
        try {
            File dest = new File("screenshots/" + testName + "_" + System.currentTimeMillis() + ".png");
            FileUtils.copyFile(src, dest);
            System.out.println("Screenshot saved: " + dest.getAbsolutePath());
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

}
