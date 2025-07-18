package com.elpais.runner;

import com.elpais.base.BaseTest;
import com.elpais.pages.HomePage;
import com.elpais.pages.OpinionPage;
import org.testng.annotations.Optional;
import org.testng.annotations.Parameters;
import org.testng.annotations.Test;

public class BrowserStackRunner extends BaseTest {

    @Parameters("browser")
    @Test
    public void testOnBrowserStack(@Optional("bs1") String browser) throws Exception {
        setUp(browser); // Manual setup using passed browser key

        HomePage home = new HomePage(driver);
        home.clickOpinion();

        OpinionPage opinion = new OpinionPage(driver);
        opinion.getTopHeadlines(3).forEach(System.out::println);

        tearDown(); // Clean up after test
    }
}
