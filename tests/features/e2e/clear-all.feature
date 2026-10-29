@FR-21
Feature: Clear All
  As the owner,
  I want to dismiss all New jobs of a view with one button, after it asks me,
  so that I can empty New without dismissing each job by hand.

  Scenario: Clear All asks first, naming how many jobs, then empties New for that view only
    Given the board has these jobs:
      | title      | view          |
      | Clear SDET | LinkedIn      |
      | Clear QA   | LinkedIn      |
      | Feed SDET  | Other sources |
    When I open the board
    And I press Clear All
    Then the board asks "Dismiss all 2 new LinkedIn jobs? Each one can be restored from Dismissed."
    When I confirm with "Dismiss 2 jobs"
    Then the board says "Dismissed 2 new LinkedIn jobs. Each one can be restored from Dismissed."
    And the New tab is empty
    When I open the Other sources view
    Then the board lists "Feed SDET"
