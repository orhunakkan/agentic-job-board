@FR-01
Feature: My profile, for any line of work
  As the owner,
  I want to fill in and edit my profile on the board,
  so that every score is based on my own line of work.

  Background:
    Given the board has never been set up

  Scenario: Filling in a nurse's profile opens the board
    When I open the board
    And I fill in my profile as an ICU nurse
    Then my profile is saved, with "Registered nursing, critical care" as my line of work
    When I open the board
    Then I see the board

  Scenario: A wrong entry is shown next to its field, and what I typed stays
    When I fill in my profile as an ICU nurse, but leave out my line of work
    Then the form says "Enter your line of work." next to my line of work
    And the job titles I want still read "ICU Registered Nurse" and "Critical Care Charge Nurse"

  Scenario: Editing the profile later
    Given I have filled in my profile as an ICU nurse
    When I edit my profile and add "San Antonio, TX" as an area where I'd work on-site
    Then my profile shows "On-site: San Antonio, TX"
