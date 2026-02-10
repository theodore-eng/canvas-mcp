import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getCanvasClient } from '../canvas-client.js';
import { formatError, formatSuccess } from '../utils.js';
import type { AssignmentGroup, Assignment, Submission } from '../types/canvas.js';

// ==================== HELPERS ====================

interface AssignmentDetail {
  id: number;
  name: string;
  score: number | null;
  points_possible: number;
  percentage: number | null;
  graded: boolean;
  due_at: string | null;
  late: boolean;
  missing: boolean;
  score_statistics?: { mean: number; min: number; max: number } | null;
}

interface GroupBreakdown {
  name: string;
  weight: number;
  earned_points: number;
  possible_points: number;
  group_percentage: number | null;
  weighted_contribution: number | null;
  drop_lowest: number | null;
  drop_highest: number | null;
  graded_count: number;
  total_count: number;
  assignments: AssignmentDetail[];
}

function getSubmission(assignment: Assignment): Submission | undefined {
  return assignment.submission;
}

function isGraded(sub: Submission | undefined): boolean {
  return !!sub && sub.workflow_state === 'graded' && sub.score !== null;
}

function buildAssignmentDetail(a: Assignment): AssignmentDetail {
  const sub = getSubmission(a);
  const graded = isGraded(sub);
  const score = graded ? (sub!.score ?? null) : null;
  const percentage = graded && a.points_possible > 0
    ? Math.round((score! / a.points_possible) * 1000) / 10
    : null;

  const stats = a.score_statistics;

  return {
    id: a.id,
    name: a.name,
    score,
    points_possible: a.points_possible,
    percentage,
    graded,
    due_at: a.due_at,
    late: sub?.late ?? false,
    missing: sub?.missing ?? false,
    score_statistics: stats ?? null,
  };
}

/**
 * Apply Canvas drop rules: remove the N lowest and/or N highest scoring
 * graded assignments from a group before computing the group grade.
 * Only drops from graded assignments — ungraded ones are untouched.
 */
function applyDropRules(
  gradedAssignments: AssignmentDetail[],
  dropLowest: number,
  dropHighest: number
): AssignmentDetail[] {
  if (gradedAssignments.length === 0) return gradedAssignments;

  // Sort by percentage (score / points_possible) for fair comparison across different point values
  const sorted = [...gradedAssignments].sort((a, b) => {
    const aPct = a.points_possible > 0 ? (a.score ?? 0) / a.points_possible : 0;
    const bPct = b.points_possible > 0 ? (b.score ?? 0) / b.points_possible : 0;
    return aPct - bPct; // lowest first
  });

  // Don't drop more than we have (Canvas behavior)
  const totalToDrop = Math.min(dropLowest + dropHighest, sorted.length - 1);
  const actualDropLowest = Math.min(dropLowest, totalToDrop);
  const actualDropHighest = Math.min(dropHighest, totalToDrop - actualDropLowest);

  // Build set of IDs to drop
  const dropIds = new Set<number>();
  for (let i = 0; i < actualDropLowest; i++) dropIds.add(sorted[i].id);
  for (let i = 0; i < actualDropHighest; i++) dropIds.add(sorted[sorted.length - 1 - i].id);

  return gradedAssignments.filter(a => !dropIds.has(a.id));
}

function buildGroupBreakdown(group: AssignmentGroup): GroupBreakdown {
  const assignments = (group.assignments ?? []).filter(a => a.published && !a.omit_from_final_grade);
  const details = assignments.map(buildAssignmentDetail);

  const allGraded = details.filter(d => d.graded);
  const dropLowest = group.rules?.drop_lowest ?? 0;
  const dropHighest = group.rules?.drop_highest ?? 0;

  // Apply drop rules before computing group grade
  const gradedAfterDrops = (dropLowest > 0 || dropHighest > 0)
    ? applyDropRules(allGraded, dropLowest, dropHighest)
    : allGraded;

  const earned = gradedAfterDrops.reduce((sum, d) => sum + (d.score ?? 0), 0);
  const possible = gradedAfterDrops.reduce((sum, d) => sum + d.points_possible, 0);

  const groupPct = possible > 0
    ? Math.round((earned / possible) * 1000) / 10
    : null;

  const weightedContribution = groupPct !== null
    ? Math.round((groupPct * group.group_weight / 100) * 100) / 100
    : null;

  return {
    name: group.name,
    weight: group.group_weight,
    earned_points: earned,
    possible_points: possible,
    group_percentage: groupPct,
    weighted_contribution: weightedContribution,
    drop_lowest: dropLowest || null,
    drop_highest: dropHighest || null,
    graded_count: allGraded.length,
    total_count: assignments.length,
    assignments: details,
  };
}

function computeWeightedGrade(groups: GroupBreakdown[], usesWeights: boolean): number | null {
  if (usesWeights) {
    // Weighted: sum of weighted contributions, normalized by total weight of groups that have graded work
    const groupsWithGrades = groups.filter(g => g.group_percentage !== null && g.weight > 0);
    if (groupsWithGrades.length === 0) return null;

    const totalWeight = groupsWithGrades.reduce((sum, g) => sum + g.weight, 0);
    const weightedSum = groupsWithGrades.reduce((sum, g) => sum + (g.weighted_contribution ?? 0), 0);

    // Normalize to the weight of groups that actually have grades
    return totalWeight > 0
      ? Math.round((weightedSum / totalWeight) * 10000) / 100
      : null;
  } else {
    // Unweighted: total earned / total possible across all groups
    const totalEarned = groups.reduce((sum, g) => sum + g.earned_points, 0);
    const totalPossible = groups.reduce((sum, g) => sum + g.possible_points, 0);
    return totalPossible > 0
      ? Math.round((totalEarned / totalPossible) * 1000) / 10
      : null;
  }
}

function projectGrade(
  groups: GroupBreakdown[],
  usesWeights: boolean,
  assumedPct: number
): number | null {
  // Create projected groups where ungraded assignments get the assumed percentage
  // Then apply drop rules to the full set (graded + projected)
  const projectedGroups: GroupBreakdown[] = groups.map(g => {
    // Build projected details: real graded + hypothetical ungraded
    const allProjected: AssignmentDetail[] = g.assignments.map(a => {
      if (a.graded) return a;
      if (a.points_possible <= 0) return a;
      return {
        ...a,
        graded: true,
        score: a.points_possible * assumedPct / 100,
        percentage: assumedPct,
      };
    });

    const allGraded = allProjected.filter(a => a.graded);

    // Apply drop rules to the full projected set
    const dropLowest = g.drop_lowest ?? 0;
    const dropHighest = g.drop_highest ?? 0;
    const afterDrops = (dropLowest > 0 || dropHighest > 0)
      ? applyDropRules(allGraded, dropLowest, dropHighest)
      : allGraded;

    const newEarned = afterDrops.reduce((sum, a) => sum + (a.score ?? 0), 0);
    const newPossible = afterDrops.reduce((sum, a) => sum + a.points_possible, 0);
    const newPct = newPossible > 0
      ? Math.round((newEarned / newPossible) * 1000) / 10
      : g.group_percentage;

    return {
      ...g,
      earned_points: newEarned,
      possible_points: newPossible,
      group_percentage: newPct,
      weighted_contribution: newPct !== null
        ? Math.round((newPct * g.weight / 100) * 100) / 100
        : null,
    };
  });

  return computeWeightedGrade(projectedGroups, usesWeights);
}

/**
 * Build projected groups with specific hypothetical scores applied to individual assignments.
 * Used by both calculate_what_if_grade and calculate_target_grade.
 */
function buildProjectedGroups(
  assignmentGroups: AssignmentGroup[],
  hypotheticalMap: Map<number, number>,
): { groups: GroupBreakdown[]; scenariosApplied: Array<{ assignment: string; hypothetical_score: number; points_possible: number }> } {
  const scenariosApplied: Array<{
    assignment: string;
    hypothetical_score: number;
    points_possible: number;
  }> = [];

  const groups: GroupBreakdown[] = assignmentGroups
    .sort((a, b) => a.position - b.position)
    .map(group => {
      const assignments = (group.assignments ?? []).filter(
        a => a.published && !a.omit_from_final_grade
      );

      const details: AssignmentDetail[] = [];

      for (const a of assignments) {
        const sub = getSubmission(a);
        const hypothetical = hypotheticalMap.get(a.id);
        let score: number | null;
        let graded: boolean;

        if (hypothetical !== undefined) {
          score = hypothetical;
          graded = true;
          scenariosApplied.push({
            assignment: a.name,
            hypothetical_score: hypothetical,
            points_possible: a.points_possible,
          });
        } else {
          graded = isGraded(sub);
          score = graded ? (sub!.score ?? null) : null;
        }

        const pct = graded && score !== null && a.points_possible > 0
          ? Math.round((score / a.points_possible) * 1000) / 10
          : null;

        details.push({
          id: a.id,
          name: a.name,
          score,
          points_possible: a.points_possible,
          percentage: pct,
          graded,
          due_at: a.due_at,
          late: sub?.late ?? false,
          missing: sub?.missing ?? false,
        });
      }

      // Apply drop rules before computing group grade
      const allGraded = details.filter(d => d.graded);
      const dropLowest = group.rules?.drop_lowest ?? 0;
      const dropHighest = group.rules?.drop_highest ?? 0;
      const gradedAfterDrops = (dropLowest > 0 || dropHighest > 0)
        ? applyDropRules(allGraded, dropLowest, dropHighest)
        : allGraded;

      const earned = gradedAfterDrops.reduce((sum, d) => sum + (d.score ?? 0), 0);
      const possible = gradedAfterDrops.reduce((sum, d) => sum + d.points_possible, 0);

      const groupPct = possible > 0
        ? Math.round((earned / possible) * 1000) / 10
        : null;

      const weightedContribution = groupPct !== null
        ? Math.round((groupPct * group.group_weight / 100) * 100) / 100
        : null;

      return {
        name: group.name,
        weight: group.group_weight,
        earned_points: earned,
        possible_points: possible,
        group_percentage: groupPct,
        weighted_contribution: weightedContribution,
        drop_lowest: dropLowest || null,
        drop_highest: dropHighest || null,
        graded_count: allGraded.length,
        total_count: assignments.length,
        assignments: details,
      };
    });

  return { groups, scenariosApplied };
}

// ==================== TOOL REGISTRATION ====================

export function registerGradeAnalysisTools(server: McpServer) {
  const client = getCanvasClient();

  // ==================== GET GRADE BREAKDOWN ====================

  server.tool(
    'get_grade_breakdown',
    'Get a detailed grade breakdown for a course showing assignment group weights, scores per group, individual assignment performance, and the course syllabus. Cross-references Canvas data with the syllabus for accurate grading policies, letter grade cutoffs, late penalties, and drop rules. Essential for understanding where your grade really stands.',
    {
      course_id: z.number().int().positive().describe('The Canvas course ID'),
    },
    async ({ course_id }) => {
      try {
        // Fetch course, assignment groups, and syllabus in parallel
        const [course, assignmentGroups, syllabus] = await Promise.all([
          client.getCourse(course_id, ['total_scores']),
          client.listAssignmentGroups(course_id, {
            include: ['assignments', 'submission', 'score_statistics'],
          }),
          client.getCourseSyllabus(course_id).catch(() => null),
        ]);

        const usesWeights = course.apply_assignment_group_weights;

        // Build breakdown for each group
        const groups = assignmentGroups
          .sort((a, b) => a.position - b.position)
          .map(buildGroupBreakdown);

        // Find strongest and weakest groups (only those with graded work)
        const gradedGroups = groups.filter(g => g.group_percentage !== null);
        const strongest = gradedGroups.length > 0
          ? gradedGroups.reduce((best, g) =>
              (g.group_percentage ?? 0) > (best.group_percentage ?? 0) ? g : best)
          : null;
        const weakest = gradedGroups.length > 0
          ? gradedGroups.reduce((worst, g) =>
              (g.group_percentage ?? Infinity) < (worst.group_percentage ?? Infinity) ? g : worst)
          : null;

        // Calculate ungraded points remaining
        const ungradedPointsRemaining = groups.reduce((sum, g) => {
          const ungradedInGroup = g.assignments
            .filter(a => !a.graded)
            .reduce((s, a) => s + a.points_possible, 0);
          return sum + ungradedInGroup;
        }, 0);

        // Get current overall score from enrollment
        const enrollment = course.enrollments?.[0];
        const overallCurrentScore = enrollment?.computed_current_score ?? null;

        // Project grades at different performance levels
        const gradeIfPerfect = projectGrade(groups, usesWeights, 100);
        const gradeIf80 = projectGrade(groups, usesWeights, 80);
        const gradeIf60 = projectGrade(groups, usesWeights, 60);

        return formatSuccess({
          course_name: course.name,
          course_code: course.course_code,
          uses_weighted_groups: usesWeights,
          overall_current_score: overallCurrentScore,
          // Include syllabus so the LLM can cross-reference grading policies,
          // late policies, grading scales, and other details Canvas doesn't expose via API
          syllabus: syllabus
            ? {
                available: true,
                text: syllabus.text,
                note: 'Cross-reference this syllabus with the grade data below. The syllabus is the source of truth for grading policies, letter grade cutoffs, late penalties, drop rules, and extra credit. Flag any discrepancies between Canvas data and syllabus policies.',
              }
            : { available: false, note: 'No syllabus found — grade data is from Canvas API only.' },
          groups: groups.map(g => ({
            name: g.name,
            weight: g.weight,
            earned_points: g.earned_points,
            possible_points: g.possible_points,
            group_percentage: g.group_percentage,
            weighted_contribution: g.weighted_contribution,
            drop_lowest: g.drop_lowest,
            drop_highest: g.drop_highest,
            graded_count: g.graded_count,
            total_count: g.total_count,
            assignments: g.assignments,
          })),
          analysis: {
            strongest_group: strongest
              ? { name: strongest.name, percentage: strongest.group_percentage }
              : null,
            weakest_group: weakest
              ? { name: weakest.name, percentage: weakest.group_percentage }
              : null,
            ungraded_points_remaining: ungradedPointsRemaining,
            grade_if_perfect: gradeIfPerfect,
            grade_if_80pct: gradeIf80,
            grade_if_60pct: gradeIf60,
          },
        });
      } catch (error) {
        return formatError('getting grade breakdown', error);
      }
    }
  );

  // ==================== CALCULATE WHAT-IF GRADE ====================

  server.tool(
    'calculate_what_if_grade',
    "Calculate what grade you'd get under hypothetical scenarios — what you need on the final, what happens if you skip an assignment, etc. Works on both graded and ungraded assignments.",
    {
      course_id: z.number().int().positive().describe('The Canvas course ID'),
      hypothetical_scores: z
        .array(
          z.object({
            assignment_id: z.number().int().positive().describe('The assignment ID to apply a hypothetical score to'),
            score: z.number().describe('The hypothetical score (points earned)'),
          })
        )
        .describe('Array of hypothetical scores to apply'),
    },
    async ({ course_id, hypothetical_scores }) => {
      try {
        // Fetch course and assignment groups in parallel
        const [course, assignmentGroups] = await Promise.all([
          client.getCourse(course_id, ['total_scores']),
          client.listAssignmentGroups(course_id, {
            include: ['assignments', 'submission'],
          }),
        ]);

        const usesWeights = course.apply_assignment_group_weights;

        // Validate hypothetical scores and collect warnings
        const warnings: string[] = [];
        const allAssignments = assignmentGroups.flatMap(g => g.assignments ?? []);
        const assignmentLookup = new Map(allAssignments.map(a => [a.id, a]));

        for (const h of hypothetical_scores) {
          const assignment = assignmentLookup.get(h.assignment_id);
          if (!assignment) continue;

          if (assignment.points_possible > 0 && h.score > assignment.points_possible * 1.5) {
            warnings.push(
              `Score ${h.score} for "${assignment.name}" exceeds 150% of points possible (${assignment.points_possible}). This seems unusually high.`
            );
          } else if (assignment.points_possible > 0 && h.score > assignment.points_possible) {
            warnings.push(
              `Score ${h.score} for "${assignment.name}" exceeds points possible (${assignment.points_possible}). Treating as extra credit.`
            );
          }
        }

        // Build a lookup of hypothetical scores
        const hypotheticalMap = new Map(
          hypothetical_scores.map(h => [h.assignment_id, h.score])
        );

        // Build current groups (before hypotheticals)
        const currentGroups = assignmentGroups
          .sort((a, b) => a.position - b.position)
          .map(buildGroupBreakdown);

        const currentGrade = computeWeightedGrade(currentGroups, usesWeights);

        // Build projected groups with hypotheticals applied
        const { groups: projectedGroups, scenariosApplied } = buildProjectedGroups(
          assignmentGroups,
          hypotheticalMap,
        );

        const projectedGrade = computeWeightedGrade(projectedGroups, usesWeights);

        // Compute per-group impact
        const groupImpacts = currentGroups.map((current, i) => {
          const projected = projectedGroups[i];
          return {
            group: current.name,
            current_pct: current.group_percentage,
            projected_pct: projected.group_percentage,
          };
        }).filter(g => g.current_pct !== g.projected_pct);

        const change = currentGrade !== null && projectedGrade !== null
          ? Math.round((projectedGrade - currentGrade) * 10) / 10
          : null;

        const changeStr = change !== null
          ? (change >= 0 ? `+${change}` : `${change}`)
          : null;

        return formatSuccess({
          current_grade: currentGrade,
          projected_grade: projectedGrade,
          change: changeStr,
          scenarios_applied: scenariosApplied,
          group_impacts: groupImpacts,
          ...(warnings.length > 0 ? { warnings } : {}),
        });
      } catch (error) {
        return formatError('calculating what-if grade', error);
      }
    }
  );

  // ==================== CALCULATE TARGET GRADE ====================

  server.tool(
    'calculate_target_grade',
    'Calculate what score you need on a specific assignment to achieve a target overall grade. Useful for answering "what do I need on the final to get an A?"',
    {
      course_id: z.number().int().positive().describe('The Canvas course ID'),
      target_grade: z.number().min(0).max(100).describe('The target overall grade percentage'),
      assignment_id: z.number().int().positive().describe('The assignment to solve for'),
    },
    async ({ course_id, target_grade, assignment_id }) => {
      try {
        const [course, assignmentGroups] = await Promise.all([
          client.getCourse(course_id, ['total_scores']),
          client.listAssignmentGroups(course_id, {
            include: ['assignments', 'submission'],
          }),
        ]);

        const usesWeights = course.apply_assignment_group_weights;

        // Find the target assignment and its points_possible
        const allAssignments = assignmentGroups.flatMap(g => g.assignments ?? []);
        const targetAssignment = allAssignments.find(a => a.id === assignment_id);

        if (!targetAssignment) {
          return formatError('calculating target grade', new Error(
            `Assignment ${assignment_id} not found in course ${course_id}.`
          ));
        }

        if (targetAssignment.points_possible <= 0) {
          return formatError('calculating target grade', new Error(
            `Assignment "${targetAssignment.name}" has 0 points possible — cannot solve for a target score.`
          ));
        }

        // Get current grade without hypothetical on target assignment
        const currentGroups = assignmentGroups
          .sort((a, b) => a.position - b.position)
          .map(buildGroupBreakdown);
        const currentGrade = computeWeightedGrade(currentGroups, usesWeights);

        // Binary search: find the score on assignment_id that yields target_grade
        // Search range: 0 to points_possible * 1.5 (allow some extra credit)
        const maxScore = targetAssignment.points_possible * 1.5;
        let lo = 0;
        let hi = maxScore;
        let neededScore: number | null = null;

        // 50 iterations of binary search gives precision to ~10^-15
        for (let iter = 0; iter < 50; iter++) {
          const mid = (lo + hi) / 2;
          const hypotheticalMap = new Map<number, number>([[assignment_id, mid]]);
          const { groups } = buildProjectedGroups(assignmentGroups, hypotheticalMap);
          const grade = computeWeightedGrade(groups, usesWeights);

          if (grade === null) break;

          if (grade < target_grade) {
            lo = mid;
          } else {
            hi = mid;
            neededScore = mid;
          }
        }

        // Round to 2 decimal places
        if (neededScore !== null) {
          neededScore = Math.round(neededScore * 100) / 100;
        }

        const pointsPossible = targetAssignment.points_possible;
        const neededPercentage = neededScore !== null
          ? Math.round((neededScore / pointsPossible) * 1000) / 10
          : null;

        // Determine if the target is achievable (needed score <= 150% of points_possible)
        const achievable = neededScore !== null && neededScore <= maxScore;

        // If binary search couldn't find a solution (lo converged to hi at maxScore), it's not achievable
        const isUnachievable = neededScore === null || neededScore > maxScore - 0.01;

        return formatSuccess({
          course_name: course.name,
          assignment_name: targetAssignment.name,
          target_grade,
          current_grade: currentGrade,
          needed_score: isUnachievable ? null : neededScore,
          points_possible: pointsPossible,
          needed_percentage: isUnachievable ? null : neededPercentage,
          achievable: !isUnachievable,
          ...(isUnachievable
            ? { note: `A score of ${target_grade}% is not achievable with this single assignment alone. Even a perfect score (with extra credit) would not be enough.` }
            : {}),
          ...(!isUnachievable && neededPercentage !== null && neededPercentage > 100
            ? { note: `You need more than 100% — extra credit of ${neededPercentage}% would be required on this assignment.` }
            : {}),
        });
      } catch (error) {
        return formatError('calculating target grade', error);
      }
    }
  );
}
