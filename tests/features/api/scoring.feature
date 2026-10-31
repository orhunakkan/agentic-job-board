@FR-06
Feature: Scoring jobs
  As the owner,
  I want every job scored against my profile, with a label and a reason,
  so that the best matches are at the top of the board.

  Scenario: A stored score shows on the job with its label, its reason and its rubric
    Given the board has a job "Senior SDET"
    When a run scores "Senior SDET" 82 with match-v2, because "Strong Playwright match."
    Then the scores are stored
    And "Senior SDET" has the score 82, labelled Strong, because "Strong Playwright match."
    And "Senior SDET" was scored with match-v2

  Scenario: A label that doesn't match the score is refused
    Given the board has a job "Senior SDET"
    When a run scores "Senior SDET" 80 but labels it Weak
    Then the scores are refused with an explanation
    And "Senior SDET" is still unscored

  Scenario: Scores for a job that doesn't exist are refused, and none is stored
    Given the board has a job "Senior SDET"
    When a run scores "Senior SDET" and a job that doesn't exist
    Then the scores are refused, naming the job that doesn't exist
    And "Senior SDET" is still unscored

  @FR-20
  Scenario: The scoring queue names the rubric each job needs
    Given the board has these jobs:
      | title       | description               |
      | Senior SDET | Own the Playwright suite. |
      | QA Lead     |                           |
    When I ask which jobs need a score
    Then the queue holds:
      | job         | rubric    |
      | Senior SDET | match-v2  |
      | QA Lead     | triage-v2 |
