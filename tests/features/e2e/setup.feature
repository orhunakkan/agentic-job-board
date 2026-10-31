@FR-24
Feature: Setup comes first
  As the owner,
  I want the board to ask for what it needs first,
  so that every score is based on my own line of work.

  Background:
    Given the board has never been set up

  Scenario: An empty board opens on the setup checklist
    When I open the board
    Then I see the setup checklist
    And my profile reads "Not filled in" there
    And the LinkedIn searches read "Not there" there
    And the free job feeds read "Not there" there

  Scenario: With a profile but nothing to search, the board opens and points to setup
    Given I have filled in my profile as an ICU nurse
    When I open the board
    Then the board says there is nothing to search yet
    And Find Now is off, because it needs my LinkedIn searches

  Scenario: Find Now turns on once the view's own source is there
    Given I have filled in my profile as an ICU nurse
    And my free job feeds are ready
    When I open the Other sources view
    Then Find Now is on
    When I open the LinkedIn view
    Then Find Now is off, because it needs my LinkedIn searches
