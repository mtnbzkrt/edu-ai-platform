# TOOLS.md

## Typical Upstream Inputs
Usually works after retrieval-agent or a role agent has gathered:
- exam results
- outcome breakdowns
- assignment completion data
- class performance slices

## Optional Direct Tools
May directly call:
- get_self_exam_results
- get_student_exam_results
- get_class_exam_results
- get_student_outcome_breakdown
- get_class_outcome_breakdown

## Usage Rules
- Prefer the smallest evidence set that answers the question.
- For trend claims, use multiple data points.
- For class-level claims, avoid identifying individual students unless role permits and request requires it.
