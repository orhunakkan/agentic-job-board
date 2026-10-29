@FR-09
Feature: Notes on a job
  As the owner,
  I want to write notes on a job's page,
  so that what I learn about a job stays with it.

  Scenario: Notes typed on the job's page are still there after a reload
    Given the board has a new LinkedIn job "Notes Job"
    When I open "Notes Job"
    And I save these notes:
      """
      Recruiter: Sam
      Call back on Friday
      """
    Then the page says "Notes saved."
    When I reload the page
    Then the notes read:
      """
      Recruiter: Sam
      Call back on Friday
      """
