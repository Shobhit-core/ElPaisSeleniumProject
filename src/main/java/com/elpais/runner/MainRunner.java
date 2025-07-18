package com.elpais.runner;

import com.elpais.base.BaseTest;
import com.elpais.config.ConfigReader;
import com.elpais.pages.HomePage;
import com.elpais.pages.OpinionPage;
import com.elpais.utils.ImageDownloader;
import com.elpais.utils.RepeatedWordAnalyzer;
import com.elpais.utils.Translator;
import org.testng.annotations.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

public class MainRunner extends BaseTest {

    @Test
    public void runAssignmentFlow() throws Exception {
        HomePage home = new HomePage(driver);
        home.clickOpinion();

        OpinionPage opinion = new OpinionPage(driver);
        List<String> headlines = opinion.getTopHeadlines(ConfigReader.getInt("articleCount"));
        List<String> imageUrls = opinion.getImageUrls();

        ImageDownloader.download(imageUrls);

        System.out.println("===== Translated Headlines =====");
        List<String> translatedHeadlines = new ArrayList<>();
        for (String original : headlines) {
            String translation = Translator.translateFromSpanishToEnglish(original);
            String translated = Translator.unescapeUnicode(translation);
            translatedHeadlines.add(translated);

            System.out.println("Original: " + original);
            System.out.println("Translated: " + translated);
            System.out.println("-------------------------------------");

            Thread.sleep(5000);
        }

        Map<String, Integer> repeatedWords = RepeatedWordAnalyzer.findRepeatedWords(translatedHeadlines);

        System.out.println("===== Repeated Words in Translated Headlines (More than twice) =====");
        if (repeatedWords.isEmpty()) {
            System.out.println("No repeated words found.");
        } else {
            for (Map.Entry<String, Integer> entry : repeatedWords.entrySet()) {
                System.out.println(entry.getKey() + ": " + entry.getValue());
            }
        }
    }
}
