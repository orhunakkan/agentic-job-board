@FR-11
Feature: Run history
  As the owner,
  I want every finished run to report what it found,
  so that I can see at a glance what a search brought in.

  Scenario: A finished run reports its counts and its 5 best new jobs
    Given an earlier run received "Old SDET"
    And a run has started
    And the run received these jobs:
      | title          | score |
      | Senior SDET    | 91    |
      | QA Lead        | 72    |
      | Test Architect | 85    |
      | SDET II        | 40    |
      | QA Engineer    | 66    |
      | Tester         | 55    |
    When the run finishes
    Then the run reports 6 listings received, 6 new jobs, 0 seen again and 6 scored
    And its top new jobs are "Senior SDET", "Test Architect", "QA Lead", "QA Engineer" and "Tester", in that order
    And the run history lists it first
