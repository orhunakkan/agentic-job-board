@FR-17
Feature: LinkedIn and the other sources apart
  As the owner,
  I want LinkedIn jobs and jobs from the free feeds on separate views,
  so that I can go through each source on its own.

  Scenario: The switch shows how many New jobs each view has
    Given the board has these jobs:
      | title         | view          | status |
      | LinkedIn Dispatcher | LinkedIn      | New    |
      | LinkedIn Nurse   | LinkedIn      | New    |
      | Saved Nurse      | LinkedIn      | Saved  |
      | Board Dispatcher    | Other sources | New    |
    When I open the board
    Then the switch shows 2 New jobs on LinkedIn and 1 on Other sources
    And the board lists "LinkedIn Dispatcher" and "LinkedIn Nurse"

  Scenario: A job from another source names its source and links to it
    Given the board has these jobs:
      | title      | source     |
      | Board Dispatcher | Greenhouse |
    When I open the Other sources view
    Then the card for "Board Dispatcher" names Greenhouse
    And the card for "Board Dispatcher" links to the job with "Open on Greenhouse", in a new tab
