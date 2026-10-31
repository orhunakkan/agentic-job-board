@FR-11
Feature: Every run keeps its counts
  As the owner,
  I want each run to record what it found,
  so that the runs page tells me what every search brought in.

  Scenario: A run counts its listings, new jobs and jobs seen again, and keeps the scores it stores
    Given an earlier run received "Senior Dispatcher" and "Lead Nurse"
    When a later run receives "Senior Dispatcher", "Lead Nurse", "Test Architect" and "Dispatcher II"
    And the run stores scores for "Test Architect" and "Dispatcher II"
    And the run finishes
    Then the run's counts are:
      | listings received | 4 |
      | new jobs          | 2 |
      | jobs seen again   | 2 |
    And the run has a finish time
    And "Test Architect" and "Dispatcher II" have a score, and "Senior Dispatcher" and "Lead Nurse" have none
