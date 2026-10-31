@FR-08
Feature: Triage a job
  As the owner,
  I want to move a job from the board through the steps of my application,
  so that the board always shows where I am with each job.

  @FR-10
  Scenario: Save a job, mark it applied, then interviewing, and see each step in its history
    Given the board has a new LinkedIn job "Workflow Dispatcher" scored 85
    When I open the board
    And I save "Workflow Dispatcher"
    Then the board says "Workflow Dispatcher is now Saved."
    And "Workflow Dispatcher" is on the Saved tab
    When I mark "Workflow Dispatcher" as Applied
    Then "Workflow Dispatcher" is on the In progress tab
    When I open "Workflow Dispatcher"
    And I change its status to Interviewing
    Then the page says "Status changed to Interviewing."
    And its status history reads "Created as New", "New → Saved", "Saved → Applied" and "Applied → Interviewing"

  Scenario: Only the changes the workflow allows are offered
    Given the board has a new LinkedIn job "Reject Path" scored 70
    When I open the board
    Then the card for "Reject Path" offers "Save", "Applied" and "Dismiss"
    When I open "Reject Path"
    Then its page offers "Saved", "Applied" and "Dismissed"
    When I change its status to Applied
    Then its page offers "Interviewing", "Rejected" and "Dismissed"
    When I change its status to Rejected
    Then its page explains "Rejected is a final status, so it can't change any more."
    And its page offers no other status
