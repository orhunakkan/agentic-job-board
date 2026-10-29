@FR-11
Feature: Every run keeps its counts
  As the owner,
  I want each run to record what it found,
  so that the runs page tells me what every search brought in.

  Scenario: A run counts the listings, the new jobs, the jobs seen again and the scores
    Given an earlier run received "Senior SDET" and "QA Lead"
    When a later run receives "Senior SDET", "QA Lead", "Test Architect" and "SDET II"
    And the run stores scores for "Test Architect" and "SDET II"
    And the run finishes
    Then the run's counts are:
      | listings received | 4 |
      | new jobs          | 2 |
      | jobs seen again   | 2 |
      | jobs scored       | 2 |
    And the run has a finish time
