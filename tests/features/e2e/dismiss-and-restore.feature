@FR-08
Feature: Dismiss and restore
  As the owner,
  I want to dismiss a job I don't want, and bring it back if I change my mind,
  so that New holds only the jobs I'm still deciding on.

  Scenario: A dismissed job leaves New and comes back when restored
    Given the board has a new LinkedIn job "Dismiss Me" scored 40
    When I open the board
    And I dismiss "Dismiss Me"
    Then the board says "Dismiss Me is now Dismissed."
    And "Dismiss Me" is not on the New tab
    And "Dismiss Me" is on the Dismissed tab
    When I restore "Dismiss Me"
    Then the board says "Dismiss Me is now New."
    And "Dismiss Me" is on the New tab
