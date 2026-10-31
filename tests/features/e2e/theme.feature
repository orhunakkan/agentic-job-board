@FR-23
Feature: Light or dark
  As the owner,
  I want to choose light or dark,
  so that the board is comfortable to read.

  Background:
    Given my system shows pages in light
    And the board has a new LinkedIn job "Theme Dispatcher"

  Scenario: Choosing dark keeps every page dark, also after reopening the board
    When I open the board
    And I choose the dark theme
    Then the page is dark, and offers the light theme
    When I go to Runs
    Then I see the list of runs, with 1 run
    And the page is dark, and offers the light theme
    When I go to Profile
    Then the page is dark, and offers the light theme
    When I open the board
    And I open "Theme Dispatcher" from its card
    Then the page is dark, and offers the light theme
    When I close the board and open it again
    Then the page is dark, and offers the light theme

  Scenario: Choosing light again brings it back
    When I open the board
    And I choose the dark theme
    And I choose the light theme
    Then the page is light, and offers the dark theme
    When I go to Runs
    Then I see the list of runs, with 1 run
    And the page is light, and offers the dark theme
