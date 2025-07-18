package com.elpais.pages;

import org.openqa.selenium.By;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.WebElement;
import org.openqa.selenium.support.FindBy;
import org.openqa.selenium.support.PageFactory;

import java.util.ArrayList;
import java.util.List;

public class OpinionPage {
    private WebDriver driver;

    public OpinionPage(WebDriver driver) {
        this.driver = driver;
        PageFactory.initElements(driver, this);
    }

    @FindBy(xpath = "//h2//a[@cmp-ltrk='portada_apertura']")
    private List<WebElement> articleTitles;

    @FindBy(xpath = "//a[@cmp-ltrk='portada_apertura']//img")
    private List<WebElement> articleImages;



    public List<String> getTopHeadlines(int limit) {
        List<String> headlines = new ArrayList<>();
        for (int i = 0; i < Math.min(limit, articleTitles.size()); i++) {
            headlines.add(articleTitles.get(i).getText());
        }
        return headlines;
    }

    public List<String> getImageUrls() {
        List<String> urls = new ArrayList<>();

        if (articleImages != null && !articleImages.isEmpty()) {
            for (WebElement img : articleImages) {
                String src = img.getAttribute("src");
                if (src != null && !src.isEmpty()) {
                    urls.add(src);
                }
            }
        }

        return urls;
    }
}
