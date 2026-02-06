# ------------------------------------------------------------------------------
# Route 53 hosted zones (delegate from registrar: update NS records)
# ------------------------------------------------------------------------------
resource "aws_route53_zone" "com" {
  name = var.domainCom
}

resource "aws_route53_zone" "ca" {
  name = var.domainCa
}

# ------------------------------------------------------------------------------
# ACM certificate – single cert for all domains (CloudFront requires us-east-1)
# ------------------------------------------------------------------------------
resource "aws_acm_certificate" "main" {
  provider          = aws.us_east_1
  domain_name       = var.domainCom
  validation_method = "DNS"

  subject_alternative_names = [
    "*.${var.domainCom}",
    var.domainCa,
    "*.${var.domainCa}"
  ]

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "cert_validation_com" {
  for_each = {
    for dvo in aws_acm_certificate.main.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
    if strcontains(dvo.resource_record_name, var.domainCom)
  }

  allow_overwrite = true
  name            = each.value.name
  records         = [each.value.record]
  ttl             = 60
  type            = each.value.type
  zone_id         = aws_route53_zone.com.zone_id
}

resource "aws_route53_record" "cert_validation_ca" {
  for_each = {
    for dvo in aws_acm_certificate.main.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
    if strcontains(dvo.resource_record_name, var.domainCa)
  }

  allow_overwrite = true
  name            = each.value.name
  records         = [each.value.record]
  ttl             = 60
  type            = each.value.type
  zone_id         = aws_route53_zone.ca.zone_id
}

resource "aws_acm_certificate_validation" "main" {
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.main.arn
  validation_record_fqdns = concat(
    [for r in aws_route53_record.cert_validation_com : r.fqdn],
    [for r in aws_route53_record.cert_validation_ca : r.fqdn]
  )
}

# ------------------------------------------------------------------------------
# CloudFront distributions
# ------------------------------------------------------------------------------
locals {
  staging_aliases = [
    "${var.stagingSubdomain}.${var.domainCom}",
    "${var.stagingSubdomain}.${var.domainCa}"
  ]
  production_aliases = [
    var.domainCom,
    "www.${var.domainCom}",
    var.domainCa,
    "www.${var.domainCa}"
  ]
}

resource "aws_cloudfront_distribution" "staging" {
  enabled             = true
  is_ipv6_enabled     = true
  comment             = "Funkedupshift staging"
  default_root_object = "index.html"
  price_class         = "PriceClass_100"

  aliases = local.staging_aliases

  origin {
    domain_name = aws_s3_bucket_website_configuration.websiteStaging.website_endpoint
    origin_id   = "S3-${aws_s3_bucket.websiteStaging.id}"

    custom_origin_config {
      http_port             = 80
      https_port            = 443
      origin_protocol_policy = "http-only"
      origin_ssl_protocols  = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "S3-${aws_s3_bucket.websiteStaging.id}"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    min_ttl     = 0
    default_ttl = 3600
    max_ttl     = 86400
  }

  custom_error_response {
    error_code         = 404
    response_code      = 200
    response_page_path = "/index.html"
  }

  custom_error_response {
    error_code         = 403
    response_code      = 200
    response_page_path = "/index.html"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.main.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}

resource "aws_cloudfront_distribution" "production" {
  enabled             = true
  is_ipv6_enabled     = true
  comment             = "Funkedupshift production"
  default_root_object = "index.html"
  price_class         = "PriceClass_100"

  aliases = local.production_aliases

  origin {
    domain_name = aws_s3_bucket_website_configuration.websiteProduction.website_endpoint
    origin_id   = "S3-${aws_s3_bucket.websiteProduction.id}"

    custom_origin_config {
      http_port             = 80
      https_port            = 443
      origin_protocol_policy = "http-only"
      origin_ssl_protocols  = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "S3-${aws_s3_bucket.websiteProduction.id}"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    min_ttl     = 0
    default_ttl = 3600
    max_ttl     = 86400
  }

  custom_error_response {
    error_code         = 404
    response_code      = 200
    response_page_path = "/index.html"
  }

  custom_error_response {
    error_code         = 403
    response_code      = 200
    response_page_path = "/index.html"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.main.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}

# ------------------------------------------------------------------------------
# Route 53 records → CloudFront
# ------------------------------------------------------------------------------
# Staging: stage.funkedupshift.com, stage.funkedupshift.ca
resource "aws_route53_record" "staging_com" {
  zone_id = aws_route53_zone.com.zone_id
  name    = "${var.stagingSubdomain}.${var.domainCom}"
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.staging.domain_name
    zone_id                = aws_cloudfront_distribution.staging.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "staging_ca" {
  zone_id = aws_route53_zone.ca.zone_id
  name    = "${var.stagingSubdomain}.${var.domainCa}"
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.staging.domain_name
    zone_id                = aws_cloudfront_distribution.staging.hosted_zone_id
    evaluate_target_health = false
  }
}

# Production: funkedupshift.com, www, funkedupshift.ca, www
resource "aws_route53_record" "production_com_apex" {
  zone_id = aws_route53_zone.com.zone_id
  name    = var.domainCom
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.production.domain_name
    zone_id                = aws_cloudfront_distribution.production.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "production_com_www" {
  zone_id = aws_route53_zone.com.zone_id
  name    = "www.${var.domainCom}"
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.production.domain_name
    zone_id                = aws_cloudfront_distribution.production.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "production_ca_apex" {
  zone_id = aws_route53_zone.ca.zone_id
  name    = var.domainCa
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.production.domain_name
    zone_id                = aws_cloudfront_distribution.production.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "production_ca_www" {
  zone_id = aws_route53_zone.ca.zone_id
  name    = "www.${var.domainCa}"
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.production.domain_name
    zone_id                = aws_cloudfront_distribution.production.hosted_zone_id
    evaluate_target_health = false
  }
}
