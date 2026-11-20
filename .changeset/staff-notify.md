---
"@infrabyx/contracts": minor
"@infrabyx/notify": minor
---

Staff and RE-administrator notifications by role (Udofin PR-UDF-052; R1-D-222). `contracts`: a staff class (`NotificationClass.audience: "staff"`, `subject_variables`; in-app and email only, declared variables, never marketing; `STAFF_CHANNELS`), `StaffRole`, `StaffNotificationRequest`, `StaffSendResult`, `DeliveryReceipt`, the optional `NotifyPort.notifyStaff` and `deliveryReceipt`, and the error `IPB-NTF-007`. `notify`: `notifyStaff` and `enqueueStaff` find the active holders of the roles (or of an `FN:` function) in the context's tenant at send time and send a staff class whose variables carry no personal data and whose subject carries only references; nobody holding the roles is a recorded `no_recipients` outcome; `deliveryReceipt` gives each recipient's delivery states; `lintEmailTemplate` takes `subjectVariables` (`lintOptionsFor`), and `lintStaffTitles` checks staff titles at start. `send` and `enqueue` refuse a staff class; nothing existing changes otherwise. No migration, no setting.
