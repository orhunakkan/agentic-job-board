@FR-10
Feature: A job's details
  As the owner,
  I want a job's details to hold everything the board knows about it,
  so that I can decide what to do without looking elsewhere.

  Scenario: A job's details include its sightings and its status history
    Given an earlier run received the LinkedIn job "Senior SDET" from the search "QA family"
    And a later run received the LinkedIn job "Senior SDET" from the search "Senior QA"
    And I saved "Senior SDET"
    When I look at "Senior SDET"
    Then it has 2 sightings, by the searches "QA family" and "Senior QA"
    And its status history is:
      | from | to    |
      |      | New   |
      | New  | Saved |

  Scenario: A job that doesn't exist is not found
    When I look at a job that doesn't exist
    Then the job is not found
