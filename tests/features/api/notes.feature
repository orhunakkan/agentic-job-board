@FR-09
Feature: Notes on a job
  As the owner,
  I want to keep a note on each job,
  so that I remember who I spoke to and what comes next.

  Scenario: A note is saved and shown on the job
    Given the board has a job "Senior Dispatcher"
    When I write the note "Recruiter: Sam. Call back on Friday." on "Senior Dispatcher"
    Then the note is saved
    And "Senior Dispatcher" shows the note "Recruiter: Sam. Call back on Friday."

  Scenario Outline: A note of <length> characters is <outcome>
    Given the board has a job "Senior Dispatcher"
    When I write a note of <length> characters on "Senior Dispatcher"
    Then the note is <outcome>

    Examples:
      | length | outcome |
      | 5,000  | saved   |
      | 5,001  | refused |
