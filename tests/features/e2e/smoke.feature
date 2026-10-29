Feature: Smoke test
  As the owner,
  I want a quick check that the app starts and its main pages open,
  so that I know at once whether something basic is broken.

  @smoke @NFR-01
  Scenario: The app starts on the loopback address and reports ok
    When I ask the app whether it is healthy
    Then it answers on the loopback address and reports itself and its database as ok

  @smoke @FR-07
  Scenario: The board renders its tabs
    When I open the board
    Then I see the board with the tabs "New", "Saved", "In progress", "Closed" and "Dismissed"

  @smoke @FR-10
  Scenario: A job's page opens from the board
    Given the board has a new LinkedIn job "Smoke SDET" scored 88
    When I open the board
    And I open "Smoke SDET" from its card
    Then I see the page of "Smoke SDET" with its score and the reason for it

  @smoke @FR-11
  Scenario: The runs page opens
    Given the board has a new LinkedIn job "Smoke SDET"
    When I open the board
    And I go to Runs
    Then I see the list of runs, with 1 run
