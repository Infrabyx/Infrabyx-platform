# Break-glass access through SSM Session Manager only (no SSH, no bastion host), behind MFA and
# a one-hour session; off unless enabled for an incident (IPB-02 break-glass).
resource "aws_iam_role" "this" {
  count = var.enabled ? 1 : 0
  name  = "${var.name}-breakglass"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { AWS = var.trusted_principal_arns }
      Action    = "sts:AssumeRole"
      Condition = { Bool = { "aws:MultiFactorAuthPresent" = "true" } }
    }]
  })
  max_session_duration = 3600
  tags                 = var.tags
}

resource "aws_iam_role_policy_attachment" "ssm" {
  count      = var.enabled ? 1 : 0
  role       = aws_iam_role.this[0].name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}
