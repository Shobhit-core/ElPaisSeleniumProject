package com.elpais.pages;

import com.elpais.utils.WaitUtils;
import org.openqa.selenium.By;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.WebElement;
import org.openqa.selenium.support.FindBy;
import org.openqa.selenium.support.PageFactory;
import org.testng.Assert;

public class HomePage {
    private WebDriver driver; // 🔹 Store driver for use in methods

    public HomePage(WebDriver driver) {
        this.driver = driver; // 🔹 Assign it
        PageFactory.initElements(driver, this);
    }

    @FindBy(xpath = "//a[@cmp-ltrk='portada_menu' and text()='Opinión']")
    private WebElement opinionLink;

    @FindBy(xpath = "//button[@id='didomi-notice-agree-button']")
    private WebElement agreeAlertBtn;

    public void verifylanguage() {
        String pageLang = driver.findElement(By.tagName("html")).getAttribute("lang");
        Assert.assertEquals(pageLang, "es", "Website is not displayed in Spanish!");
    }

    public void clickOpinion() {
        WaitUtils.fluentWait(agreeAlertBtn, 15, 500).click();
        opinionLink.click();
    }
}
