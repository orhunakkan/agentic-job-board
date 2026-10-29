@FR-22
Feature: Find Now on the board
  As the owner,
  I want a button that runs my searches and scores what they find,
  so that I don't have to start Claude Code myself.

  In these scenarios a stand-in plays Claude Code, so no real search runs.

  Scenario: Find Now runs in the background and the board says when it has finished
    Given a Find Now run takes a moment
    When I press Find Now on the LinkedIn view
    Then the board says Find Now is running for LinkedIn
    And when the run ends, the board says Find Now for LinkedIn finished, and names its log

  Scenario: A second press while a run is going starts nothing
    Given a Find Now run takes a moment
    When I press Find Now on the LinkedIn view
    And I press Find Now on the Other sources view
    Then the board says Find Now is running for LinkedIn
    And only one run was started

  Scenario: The board says when a run failed
    Given the next Find Now run will fail with exit code 2
    When I press Find Now on the LinkedIn view
    Then when the run ends, the board says Find Now for LinkedIn stopped: exit code 2
