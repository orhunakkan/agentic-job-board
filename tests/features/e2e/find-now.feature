@FR-22
Feature: Find Now
  As the owner,
  I want to start my searches from the board and see how the run is going,
  so that I know when there are new jobs to look at.

  In these scenarios a stand-in plays Claude Code, so no real search runs.

  Scenario: While a run is going the board says so, and Find Now is disabled on both views
    Given a Find Now run takes a few seconds
    When I open the Other sources view
    And I press Find Now
    Then the board says Find Now is running for Other sources
    And Find Now is disabled
    When I open the LinkedIn view
    Then the board says Find Now is running for Other sources
    And Find Now is disabled
    When the run has ended
    Then the board says Find Now for Other sources finished, and names its log
    And Find Now is enabled
