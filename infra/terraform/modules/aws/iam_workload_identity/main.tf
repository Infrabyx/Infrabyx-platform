locals {
  issuer = trimprefix(var.oidc_issuer, "https://")
  attachments = merge([
    # Keyed by position: policy ARNs are often known only after apply.
    for sa, policies in var.workloads : { for i, p in policies : "${sa}|${i}" => { sa = sa, policy = p } }
  ]...)
}

# One role per service account, assumable only by that service account (IRSA).
resource "aws_iam_role" "this" {
  for_each = var.workloads
  name     = "${var.name}-${each.key}"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = var.oidc_provider_arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "${local.issuer}:sub" = "system:serviceaccount:${var.namespace}:${each.key}"
          "${local.issuer}:aud" = "sts.amazonaws.com"
        }
      }
    }]
  })
  max_session_duration = 3600
  tags                 = var.tags
}

resource "aws_iam_role_policy_attachment" "this" {
  for_each   = local.attachments
  role       = aws_iam_role.this[each.value.sa].name
  policy_arn = each.value.policy
}
