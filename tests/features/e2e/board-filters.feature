@FR-07
Feature: Filtering the board
  As the owner,
  I want to filter and sort the board,
  so that the jobs worth my time are at the top.

  Background:
    Given the board has these jobs:
      | title       | company  | score |
      | Strong Dispatcher | Top Co   | 91    |
      | Possible Nurse | Mid Co   | 60    |
      | Weak Courier | Low Co   | 20    |
      | Unscored Nurse | Plain Co |       |

  Scenario: The board lists the best scores first and unscored jobs last
    When I open the board
    Then the board lists "Strong Dispatcher", "Possible Nurse", "Weak Courier" and "Unscored Nurse", in that order

  Scenario: A minimum score hides the weaker jobs
    When I open the board
    And I filter for a minimum score of 50
    Then the board lists "Strong Dispatcher" and "Possible Nurse", in that order
    And the filter still shows a minimum score of 50

  Scenario: Search finds a job by its company
    When I open the board
    And I search for "Mid Co"
    Then the board lists "Possible Nurse"

  Scenario: Newest first puts the jobs found last at the top
    When I open the board
    And I sort by Newest
    Then the board lists "Unscored Nurse", "Weak Courier", "Possible Nurse" and "Strong Dispatcher", in that order
